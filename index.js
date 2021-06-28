const events = require("events");
const net = require("net");

class Main {
  constructor(self, contacts = [], referrals = [], acceptAll = false) {
    this.uuid = self.uuid;
    this.priv = self.priv;
    this.pub = self.pub;
    this.ip = self.ip;
    this.port = self.port;
    this.contacts = contacts;
    this.referrals = referrals;
    this.acceptAll = acceptAll;
    this.events = new events.EventEmitter();
    this.events_ = new events.EventEmitter();

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
    console.log("Connect: " + contact.uuid);
    return new Promise((resolve, reject) => {
      //console.log("createConnection");
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
        if (contact.connected) this.sendReferrals(contact, true);
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
        if (contact.connected) this.sendReferrals(contact, true);
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
    //console.log("send");
    return new Promise((resolve, reject) => {
      //console.log("write");
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
  respond(contact, id, message = "") {
    //console.log("respond");
    return new Promise((resolve, reject) => {
      //console.log("write");
      contact.socket.write(
        encrypt(
          contact.pub,
          JSON.stringify({
            from: this.uuid,
            secret: contact.secret,
            body: message,
            res: id,
            ip: contact.ip,
            port: contact.port
          })
        )
      );

      contact.socket.on("error", err => {
        console.log(err);
        this.connect(contact).then(() => {
          this.respond(contact, id, message)
            .then(res => resolve(res))
            .catch(err => reject(err));
        });
      });
    });
  }
  sendMessage(uuid, message) {
    this.send(this.contactFromUuid(uuid), message, "message");
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
            secret: contact_to.secret,
            IP: this.ip,
            port: this.port
          })
        },
        "IP"
      ).then(res => {
        console.log(`IP: ${res.body.ip} | Port: ${res.body.port}`);
      });
    }
  }
  sendReferrals(contact, rm = false) {
    let uuid = contact.uuid;
    for (let contact of this.contacts) {
      this.send(
        contact,
        {
          referent: uuid,
          hops: 1,
          rm: rm
        },
        "referral"
      );
    }
  }
  contactFromUuid(uuid) {
    return this.contacts.find(contact => {
      return contact.uuid == uuid;
    });
  }
  referralFromUuid(uuid) {
    return this.referrals.find(referral => {
      return referral.referent == uuid;
    });
  }
  contactFromIp(ip) {
    return this.contacts.find(contact => {
      return contact.ip === ip;
    });
  }
  handle_in(socket, raw) {
    for (let data of splitMessages(raw.toString())) {
      if (data !== "") {
        //try {
        data = decrypt(this.priv, JSON.parse(data));
        /*} catch {
        contact = this.contactFromIp(socket.remoteAddress);
        contact.ip = "";
        contact.connected = false;

        return;
      }*/
        console.log(data);
        let contact = this.contactFromUuid(data.from);
        // TODO: acceptAll
        if (data.secret == contact.secret) {
          if (contact.ip != socket.remoteAddress) {
            this.sendReferrals(contact);
          }
          contact.ip = socket.remoteAddress;
          contact.port = socket.remotePort;
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
                  if (data.body.to == this.uuid) {
                    data.body.encrypted = decrypt(
                      this.priv,
                      data.body.encrypted
                    );
                    if (
                      data.body.encrypted.secret ==
                      this.contactFromUuid(data.body.encrypted.from).secret
                    ) {
                      // TODO: Holepunching
                      this.respond(
                        contact,
                        data.id,
                        encrypt(contact.pub, {
                          ip: this.ip,
                          port: this.port
                        })
                      );
                    } else {
                      this.respond(contact, data.id);
                    }
                  } else if (this.contactFromUuid(data.body.to) != undefined) {
                    this.send(
                      this.contactFromUuid(data.body.to),
                      data.body,
                      "IP"
                    ).then(res => {
                      this.respond(contact, data.id, res.body);
                    });
                  } else if (this.referralFromUuid(data.body.to) != undefined) {
                    let promises;
                    for (let contact_ of this.referralFromUuid(data.body.to)) {
                      promises += this.send(contact_, data.body, "IP");
                    }
                    Promise.allSettled(promises).then(results => {
                      let responses = [];
                      results.forEach(result => {
                        if (result.status == "fulfilled")
                          responses.push(result.value);
                      });
                      responses = [...new Set(responses)];
                      if (responses.length == 1) responses = responses[0];
                      this.respond(contact, data.id, responses);
                    });
                  } else if (data.body.hops < 20) {
                    data.body.hops++;
                    let promises;
                    for (let contact_ of this.contacts) {
                      if (contact_.uuid != data.from)
                        promises += this.send(contact_, data.body, "IP");
                    }
                    Promise.allSettled(promises).then(results => {
                      let responses = [];
                      results.forEach(result => {
                        if (result.status == "fulfilled")
                          responses.push(result.value);
                      });
                      responses = [...new Set(responses)];
                      if (responses.length == 1) responses = responses[0];
                      this.respond(contact, data.id, responses);
                    });
                  }
                  if (this.contacts.length == 1) this.respond(contact, data.id);
                }
                break;
              case "message":
                {
                  if (data.body != "") this.events.emit("message", data.body);
                  this.respond(contact, data.id);
                }
                break;
              case "referral":
                {
                  if (this.referralFromUuid(data.body.referent) === undefined)
                    this.referrals.push({
                      referent: data.body.referent,
                      referees: []
                    });
                  let referral = this.referralFromUuid(data.body.referent);

                  if (data.body.rm) {
                    this.referrals.splice(this.referrals.indexOf(referral), 1);
                  } else {
                    if (referral.referees.indexOf(data.from) != -1)
                      referral.referees.push(data.from);
                  }
                  if (data.body.hops < 20) {
                    data.body.hops++;
                    if (referral.referees.indexOf(data.from) != -1)
                      for (contact_ of this.contacts) {
                        if (contact_.uuid != data.from)
                          this.send(contact_, data.body, "IP");
                      }
                  }
                  this.respond(contact, data.id);
                }
                break;
              case "contact_req": {
              }
            }
          }
        }
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
function splitMessages(data) {
  let chars = data.split("");
  let brackets = 0;
  let out = [""];
  let j = 0;
  for (let i = 0; i < chars.length; i++) {
    out[j] += chars[i];
    if (chars[i] == "{") brackets++;
    if (chars[i] == "}") brackets--;
    if (brackets == 0) {
      j++;
      out[j] = "";
    }
  }
  return out;
}
