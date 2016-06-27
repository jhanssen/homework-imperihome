/*global require, module, setTimeout*/

"use strict";

const http = require("http");
const util = require('util');
const url = require('url');
const EventEmitter = require('events');
const crypto = require('crypto');

function convertType(type)
{
    switch (type) {
    case "Dimmer":
        return "DevDimmer";
    case "Light":
    case "Fan":
        return "DevSwitch";
    case "Door":
        return "DevDoor";
    case "Sensor":
        return "DevMotion";
    case "RGBWLed":
        return "DevRGBLight";
    case "Thermostat":
        return "DevThermostat";
    case "Virtual":
        return "DevSwitch";
    }
    return undefined;
}

const imperiParams = {
    DevDimmer: {
        get: function(dev) {
            return [
                {
                    key: "Status",
                    value: dev.standardGet("level") > 0 ? 1 : 0
                },
                {
                    key: "Level",
                    value: dev.standardGet("level")
                }
            ];
        },
        set: function(dev, action, value) {
            //console.log(`set ${action} to ${value}`);
            let meta = dev.standardMeta("level");
            switch (action) {
            case "setStatus":
                // set max level
                if (meta.range instanceof Array && meta.range.length > 1) {
                    dev.standardSet("level", value == 1 ? meta.range[1] : meta.range[0]);
                    return true;
                }
                break;
            case "setLevel":
                if (meta.range instanceof Array && meta.range.length > 1) {
                    var val = parseInt(value);
                    if (val < meta.range[0])
                        val = meta.range[0];
                    if (val > meta.range[1])
                        val = meta.range[1];
                    dev.standardSet("level", val);
                    return true;
                }
            }
            return false;
        }
    },
    DevSwitch: {
        get: function(dev) {
            return [
                {
                    key: "Status",
                    value: dev.standardGet("value") > 0 ? 1 : 0
                }
            ];
        },
        set: function(dev, action, value) {
            //console.log(`set ${action} to ${value}`);
            switch (action) {
            case "setStatus":
                // set max level
                dev.standardSet("value", value == 1 ? 1 : 0);
                return true;
            }
            return false;
        }
    },
    DevMotion: {
        get: function(dev) {
            return [
                {
                    key: "armable",
                    value: 0
                },
                {
                    key: "ackable",
                    value: 0
                },
                {
                    key: "Tripped",
                    value: dev.standardGet("Motion") ? 1 : 0
                }
            ];
        }
    }
};

const roomToID = Object.create(null);
const IDtoRoom = Object.create(null);

function roomId(room, floor)
{
    if (room == undefined)
        room = "";
    if (floor == undefined)
        floor = "";
    let r = room + ":" + floor;
    if (r in roomToID)
        return roomToID[r];

    const hash = crypto.createHash('sha1').update(r).digest('hex');
    roomToID[r] = hash;
    IDtoRoom[hash] = { room: room, floor: floor };
    return hash;
}

function findDevice(homework, uuid)
{
    var devs = homework.devices;
    if (!(devs instanceof Array))
        return undefined;
    return devs.find((d) => { return d.uuid == uuid; });
}

function handleRequest(req, res)
{
    const parsedUrl = url.parse(req.url);
    const path = parsedUrl.pathname.split("/").filter((p) => { return p.length > 0; });

    const handlers = {
        devices: (path, write) => {
            if (!path.length) {
                // list all devices
                let devices = this.homework.devices;
                let ret = [];
                for (var i = 0; i < devices.length; ++i) {
                    var hdev = devices[i];
                    var itype = convertType(hdev.type);
                    if (itype !== undefined) {
                        var idev = {
                            id: hdev.uuid,
                            name: hdev.name,
                            room: roomId(hdev.room, hdev.floor),
                            type: itype
                        };
                        if (itype in imperiParams)
                            idev.params = imperiParams[itype].get(hdev);
                        ret.push(idev);
                    }
                }
                write({ devices: ret });
            } else if (path.length == 4 && path[1] == "action") {
                // set value
                let device = findDevice(this.homework, path[0]);
                if (device) {
                    let ok = false;
                    if ((itype = convertType(device.type))) {
                        if (itype in imperiParams && "set" in imperiParams[itype]) {
                            if (imperiParams[itype].set(device, path[2], path[3])) {
                                write({ success: true });
                                ok = true;
                            }
                        }
                    }
                    if (!ok) {
                        write(`Couldn't set ${path[2]} for ${path[0]} to ${path[3]}`);
                    }
                } else {
                    write("Couldn't find device");
                }
            } else {
                write("Invalid path");
            }
        },
        rooms: (path, write) => {
            let rooms = {};
            let devices = this.homework.devices;
            for (var i = 0; i < devices.length; ++i) {
                var device = devices[i];
                var floor = device.floor || "";
                if (device.room && device.room.length) {
                    if (floor.length)
                        floor += " ";
                    floor += device.room;
                }
                if (floor.length)
                    rooms[floor] = { room: device.room, floor: device.floor };
                else
                    rooms["(not set)"] = {};
            }
            let ret = [];
            for (var room in rooms) {
                ret.push({ id: roomId(rooms[room].room, rooms[room].floor),
                           name: room });
            }
            write({ rooms: ret });
        },
        system: (path, write) => {
            write({ id: "homework", apiversion: 0 });
        }
    };

    console.log("imperihome", path);
    if (path[0] in handlers) {
        handlers[path[0]](path.slice(1), (obj) => {
            console.log("writing", JSON.stringify(obj, null, 4));
            if (typeof obj === "object") {
                res.writeHead(200, {'Content-Type': 'application/json'});
                res.end(JSON.stringify(obj));
            } else {
                res.writeHead(404, {'Content-Type': 'text/plain'});
                if (typeof obj === "string")
                    res.end(obj);
                else
                    res.end("404 Bad request");
            }
        });
    } else {
        res.writeHead(404, {'Content-Type': 'text/plain'});
        res.end("404 Path not found");
    }
}

function ImperiHome()
{
}

ImperiHome.prototype = {
    _homework: undefined,
    _server: undefined,

    get name() { return "imperihome"; },
    get ready() { return true; },

    get homework() { return this._homework; },

    init: function(cfg, data, homework) {
        if (!cfg)
            cfg = {};

        this._homework = homework;

        var port = cfg.port || 8095;

        this._server = http.createServer(handleRequest.bind(this));
        this._server.listen(port);

        EventEmitter.call(this);
        return true;
    },
    shutdown: function(cb) {
        cb();
    }
};

util.inherits(ImperiHome, EventEmitter);

module.exports = new ImperiHome();
