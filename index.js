const events = require("events");
const net = require("net");

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
          this.handle_in(socket, data);
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
      contact.socket.on("data", data => {
        this.handle_in(contact.socket, data);
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
            id: id,
            ip: contact.ip,
            port: contact.port
          })
        )
      );

      this.events_.prependOnceListener("id-" + id, data => {
        resolve(data);
      });
      /*contact.socket.prependOnceListener("data", data => {
        console.log(data);
        resolve(data);
      });*/
      contact.socket.on("error", err => {
        console.log(err);
        this.connect(contact).then(() => {
          this.send(contact, message, type)
            .then(res => resolve(res))
            .catch(err => reject(err));
        });
      });
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
  handle_in(socket, data) {
    data = decrypt(this.priv, JSON.parse(data));
    console.log(data);
    let contact = this.contactFromUuid(data.from);
    if (data.secret == contact.secret) {
      contact.connected = true;
      contact.try = 0;
      this.port = data.port;
      this.ip = data.ip;
      if (data.res != undefined) {
        this.events_.emit("id-" + data.res, data);
      } else {
        switch (data.type) {
          case "IP":
            {
            }
            break;
          case "message":
            {
              if (data.body != "") this.events.emit("message", data.body);
            }
            break;
          case "referral":
            {
            }
            break;
          case "contact_req": {
          }
        }
        socket.write(
          JSON.stringify({
            res: data.id,
            ip: socket.remoteAddress,
            port: socket.remotePort,
            secret: contact.secret,
            from: this.uuid
          })
        );
      }
    }
  }
}
exports.Main = Main;

function encrypt(key, message) {
  return message;
}
function decrypt(key, message) {
  return message;
}
