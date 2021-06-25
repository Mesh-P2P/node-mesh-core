mesh = require("./index.js");
instance = new mesh.Main(
  {uuid: 2, pub: 3, priv: 1, ip: "192.168.178.211", port: 7575},
  [{uuid: 4, pub: 2, ip: "192.168.178.211", port: 7777, secret: 6}]
);
instance2 = new mesh.Main(
  {uuid: 4, pub: 3, priv: 1, ip: "192.168.178.211", port: 7777},
  [{uuid: 2, pub: 5, ip: "192.168.178.211", port: 7575, secret: 6}]
);
