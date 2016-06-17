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
                            id: "a" + i,//hdev.uuid,
                            name: hdev.name,
                            room: roomId(hdev.room, hdev.floor),
                            type: itype
                        };
                        // var hvals = hdev.values;
                        // var ivals = [];
                        // for (var hvk in hvals) {
                        //     var hval = hvals[hvk];
                        //     ivals.push({
                        //         key: hvk,
                        //         value: hval.value,
                        //         unit: hval.unit,
                        //         graphable: false
                        //     });
                        // }
                        // idev.params = ivals;
                        var ivals = [{ key: "Status", value: 0 }, { key: "Energy", value: 0 }, { key: "pulseable", value: 0 }];
                        idev.params = ivals;
                        ret.push(idev);
                    }
                }
                write({ devices: ret });
            } else if (path.length == 4 && path[1] == "action") {
                // set value
                let device = findDevice(this.homework, path[0]);
                if (device) {
                    if (path[2] in device.values) {
                        console.log(`setting device to ${path[3]}`);
                        device.values[path[2]].value = path[3];

                        write({ success: true });
                    } else {
                        write("Couldn't find value");
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
            console.log("writing", obj);
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
