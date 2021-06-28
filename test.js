mesh = require("./index.js");
instance = new mesh.Main(
  {uuid: 2, pub: 3, priv: 1, ip: "127.0.0.1", port: 7575},
  [
    {uuid: 4, pub: 2, ip: "127.0.0.1", port: 7777, secret: 6},
    {uuid: 7, pub: 2, ip: "127.0.0.1", port: 9041, secret: 1}
  ]
);
instance2 = new mesh.Main(
  {uuid: 4, pub: 3, priv: 1, ip: "127.0.0.1", port: 7777},
  [
    {uuid: 2, pub: 5, ip: "127.0.0.1", port: 7575, secret: 6},
    {uuid: 7, pub: 2, ip: "127.0.0.1", port: 9041, secret: 3}
  ]
);
instance3 = new mesh.Main(
  {uuid: 7, pub: 3, priv: 1, ip: "127.0.0.1", port: 9041},
  [
    {uuid: 2, pub: 5, ip: "127.0.0.1", port: 7575, secret: 1},
    {uuid: 4, pub: 3, ip: "127.0.0.1", port: 7777, secret: 3}
  ]
);
instance2.events.on("message", message => {
  console.log(message);
});
setTimeout(() => {
  instance.sendIP(instance.contactFromUuid(4));
}, 100);
