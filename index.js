const events = require("events");
const net = require("net");
const http = require("http");

class Main {
  constructor(self, contacts = [], referrals = []) {
    this.uuid = self.uuid;
    this.priv = self.priv;
    this.pub = self.pub;
    this.ip = self.ip;
    this.port = self.port;
    this.contacts = contacts;
    this.referrals = referrals;
    this.events = new events.EventEmitter();
    this.events_ = new events.EventEmitter();
    this.agent = new http.Agent({keepalive: true});

    for (let contact of this.contacts) {
      this.connect(contact).catch(err => {
        console.warn(err);
      });
    }
    net
      .createServer(socket => {
        socket.on("data", data => {
          data = JSON.parse(data);
          console.log(data);
          let contact = this.contactFromUuid(data.from);
          contact.connected = true;
          if (data.res != undefined) {
            console.log(data.res);
            this.events_.emit("id-" + data.res, data);
          } else {
            console.log(data.id);
            socket.write(
              JSON.stringify({
                res: data.id,
                IP: socket.remoteAddress,
                port: socket.remotePort,
                secret: contact.secret
              })
            );
          }
        });
      })
      .listen(this.port);
  }
  connect(contact) {
    console.log("Connect");
    return new Promise((resolve, reject) => {
      console.log("createConnection");
      contact.socket = net.createConnection({
        port: contact.port,
        host: contact.ip
      });
      contact.socket.setKeepAlive(true);
      contact.socket.on("ready", () => {
        this.send(contact, "", "message");
        contact.try = 0;
        contact.connected = true;
        resolve();
      });
      contact.socket.on("close", () => {
        contact.connected = false;
        console.log("close");
        if (contact.try < 20) {
          this.connect(contact).catch(err => {
            reject(err);
          });
        } else {
          this.sendIP(contact);
        }
      });
      contact.socket.on("timeout", () => {
        contact.connected = false;
        console.log("timeout");
        contact.socket.end();
        if (contact.try < 20) {
          this.connect(contact).catch(err => {
            reject(err);
          });
        } else {
          this.sendIP(contact);
        }
      });
    });
  }
  addContact(uuid) {}
  send(contact, message, type) {
    console.log("send");
    return new Promise((resolve, reject) => {
      console.log("write");
      let id = Math.floor(Math.random() * 10000);
      contact.socket.write(
        encrypt(
          contact.pub,
          JSON.stringify({
            from: this.uuid,
            secret: contact.secret,
            type: type,
            body: message,
            id: id
          })
        )
      );

      this.events_.prependOnceListener("id-" + id, data => {
        console.log(data);
        resolve(data);
      });
      /*contact.socket.prependOnceListener("data", data => {
        console.log(data);
        resolve(data);
      });*/
      contact.socket.on("error", err => {
        console.log(err);
        debugger;
        this.connect(contact).then(() => {
          this.send(contact, message, type)
            .then(res => resolve(res))
            .catch(err => reject(err));
        });
      });

      /*const req = http.request(
        {
          agent: this.agent,
          host: contact.ip,
          port: contact.port,
          localPort: this.port,
          localAddress: this.ip,
          method: "POST",
          Connection: "keep-alive",
          headers: encrypt(contact.pub, {
            from: this.uuid,
            secret: contact.secret,
            type: type
          })
        },
        res => {
          let headers = decrypt(this.priv, res.headers);
          let content = "";
          res.on("data", data => {
            content += data;
          });
          res.on("end", () => {
            resolve({
              body: content,
              header: headers
            });
          });
        }
      );
      req.on("error", err => {
        // TODO
        reject(err);
      });

      req.write(encrypt(contact.pub, message));
      req.end();*/
    });
  }
  sendMessage(uuid, message) {
    this.send(this.contactFromUuid(uuid), message, "message").then(res => {
      return res;
    });
  }
  sendIP(contact_to) {
    for (let contact of this.contacts) {
      this.send(
        contact,
        {
          to: contact_to.uuid,
          hops: 0,
          encrypted: encrypt(contact_to.pub, {
            from: this.uuid,
            secret: this.secret,
            IP: this.ip,
            port: this.port
          })
        },
        "IP"
      );
    }
  }
  contactFromUuid(uuid) {
    return this.contacts.find(contact => {
      return contact.uuid == uuid;
    });
  }
  contactFromIp(ip) {
    return this.contacts.find(contact => {
      return contact.ip === ip;
    });
  }
}
exports.Main = Main;

function encrypt(key, message) {
  return message;
}
function decrypt(key, message) {
  return message;
}
