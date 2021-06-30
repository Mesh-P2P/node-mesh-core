const events = require("events");
const net = require("net");
const getPort = require("get-port");
const isIPv4 = /^::(ffff)?:(?!0)(?!.*\.$)((1?\d?\d|25[0-5]|2[0-4]\d)(\.|$)){4}$/;

class Main {
  constructor(self, contacts = [], referrals = [], server = false) {
    this.uuid = self.uuid;
    this.priv = self.priv;
    this.pub = self.pub;
    this.ip = self.ip;
    this.port = self.port;
    this.contacts = contacts;
    this.contacts.forEach(contact => (contact.try = 0));
    this.referrals = referrals;
    this.server = server;
    this.servers = [];
    this.events = new events.EventEmitter().setMaxListeners(0);
    this.events_ = new events.EventEmitter().setMaxListeners(0);
    console.log(this.uuid + " created");

    for (let contact of this.contacts) {
      this.connect(contact).catch(err => {
        console.warn(err);
      });
    }
    if (this.server)
      this.servers.push({
        server: net
          .createServer(socket => {
            socket.on("data", data => {
              this.handle_in(socket, data);
            });
          })
          .listen(this.port),
        port: this.port
      });
  }
  connect(contact) {
    return new Promise((resolve, reject) => {
      //console.log("createConnection");
      if (
        contact.socket &&
        !contact.socket.destroyed &&
        !contact.socket._hadError
      ) {
        this.send(contact, "", "message");
      } else {
        if (!this.servers.find(server => contact.port == server.port)) {
          contact.socket = net.createConnection({
            port: contact.remotePort,
            host: contact.remoteIP
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
          contact.socket.on("error", err => {
            if (
              contact.connected &&
              this.referralFromUuid(contact.uuid) != undefined
            ) {
              this.referrals.splice(
                this.referrals.indexOf(this.referralFromUuid(contact.uuid)),
                1
              );
              this.sendReferrals(contact, true);
            }

            contact.connected = false;
            contact.try++;
            if (contact.try < 10) {
              setTimeout(() => {
                this.connect(contact).catch(err => {
                  reject(err);
                });
              }, 10);
            } else if (contact.try < 20) {
              this.sendIP(contact);
            } else console.log(err);
          });
          contact.socket.on("timeout", () => {
            if (
              contact.connected &&
              this.referralFromUuid(contact.uuid) != undefined
            ) {
              this.referrals.splice(
                this.referrals.indexOf(this.referralFromUuid(contact.uuid)),
                1
              );
              this.sendReferrals(contact, true);
            }
            contact.connected = false;
            console.log("timeout");
            contact.socket.end();
            contact.try++;
            if (contact.try < 20) {
              this.connect(contact).catch(err => {
                reject(err);
              });
            } else if (contact.try < 50) {
              this.sendIP(contact);
            } else console.log(err);
          });
        }
      }
    });
  }
  addContact(uuid) {}
  send(contact, message, type) {
    return new Promise((resolve, reject) => {
      //console.log("write");
      let id = Math.floor(Math.random() * 10000);
      console.log({
        from: this.uuid,
        secret: contact.secret,
        type: type,
        body: message,
        id: id,
        ip: contact.remoteIP,
        port: contact.remotePort
      });
      contact.socket.write(
        encrypt(
          contact.pub,
          JSON.stringify({
            from: this.uuid,
            secret: contact.secret,
            type: type,
            body: message,
            id: id,
            ip: contact.remoteIP,
            port: contact.remotePort
          })
        )
      );

      this.events_.prependOnceListener("id-" + id, data => {
        resolve(data);
      });
      contact.socket.on("error", err => {
        debugger;
        contact.connected = false;
        this.events_.removeAllListeners("id-" + id);
        console.log("send from " + this.uuid + err);
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
      console.log({
        from: this.uuid,
        secret: contact.secret,
        body: message,
        res: id,
        ip: contact.remoteIP,
        port: contact.remotePort
      });
      contact.socket.write(
        encrypt(
          contact.pub,
          JSON.stringify({
            from: this.uuid,
            secret: contact.secret,
            body: message,
            res: id,
            ip: contact.remoteIP,
            port: contact.remotePort
          })
        )
      );

      contact.socket.on("error", err => {
        debugger;
        console.warn(err);
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
  async sendIP(contact_to) {
    console.log("sendIP for " + contact_to.uuid + " from " + this.uuid);
    contact_to.localPort = await getPort();
    console.log(contact_to.localPort);
    if (this.servers.length > 0) {
      contact_to.localPort = this.servers[0].port;
    }

    for (let contact of this.contacts) {
      if (
        contact.connected &&
        contact.uuid != contact_to.uuid &&
        contact.socket &&
        !contact.socket.destroyed &&
        !contact.socket._hadError
      )
        this.send(
          contact,
          {
            to: contact_to.uuid,
            hops: 0,
            encrypted: encrypt(contact_to.pub, {
              from: this.uuid,
              secret: contact_to.secret,
              IP: this.ip,
              port: contact_to.localPort
            })
          },
          "IP"
        )
          .then(res => {
            if (res != "") this.punchHole(contact_to, res.body, 10);
          })
          .catch(err => console.warn(err));
    }
  }
  sendReferrals(contact, rm = false) {
    let uuid = contact.uuid;
    for (let contact of this.contacts) {
      if (contact.connected)
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
  punchHole(contact, data, timeout = 0) {
    let port = contact.localPort + 1;
    port--;
    if (!contact.connected) {
      setTimeout(() => {
        console.log("punch on " + port);
        let socket = net.createConnection({
          host: data.ip,
          port: data.port,
          localPort: port,
          timeout: 100
        });
        socket.on("data", data => {
          this.handle_in(socket, data);
        });
        socket.on("ready", () => {
          console.log("client: " + this.uuid);
          contact.socket = socket;
          this.send(contact, "", "message");
        });
        socket.on("error", err => {
          console.log(err);
        });
        socket.on("close", err => {
          console.log("server: " + this.uuid);
          debugger;
          if (!this.servers.find(server => server.port == contact.localPort)) {
            let server = net.createServer(socket => {
              socket.on("ready", () => {
                contact.connected = true;
                contact.socket = socket;
              });
              socket.on("data", data => {
                this.handle_in(socket, data);
              });
              socket.on("error", err => {
                console.log("holepunch error: " + err);
                contact.connected = false;
                this.servers.splice(
                  this.servers.indexOf(
                    this.servers.find(server_ => server == server_)
                  ),
                  1
                );
              });
            });
            server.listen(port);
            this.servers.push({
              server: server,
              port: port
            });
            server.on("error", err => {
              console.log(err);
            });
          }
        });
      }, timeout);
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
      return contact.remoteIP === ip;
    });
  }
  async handle_in(socket, raw) {
    for (let data of splitMessages(raw.toString())) {
      if (data !== "") {
        let remoteAddress = isIPv4.test(socket.remoteAddress)
          ? socket.remoteAddress.replace(/^.*:/, "")
          : socket.remoteAddress;
        try {
          data = decrypt(this.priv, JSON.parse(data));
        } catch {
          return;
        }
        let contact = this.contactFromUuid(data.from);
        // TODO: server
        if (contact != undefined && data.secret == contact.secret) {
          if (contact.remoteIP != remoteAddress) {
            this.sendReferrals(contact);
          }
          contact.socket = socket;
          contact.remoteIP = remoteAddress;
          contact.remotePort = socket.remotePort;
          contact.connected = true;
          contact.try = 0;
          contact.localPort = data.port;
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
                      //holepunching
                      let contact_to = this.contactFromUuid(
                        data.body.encrypted.from
                      );
                      if (!contact_to.connected) {
                        contact_to.localPort = await getPort();
                        if (this.servers.length > 0) {
                          contact_to.localPort = this.servers[0].port;
                        }
                        this.punchHole(contact_to, data.body.encrypted);

                        console.log("punch1");
                        this.respond(
                          contact,
                          data.id,
                          encrypt(contact.pub, {
                            ip: this.ip,
                            port: contact_to.localPort
                          })
                        );
                      } else this.respond(contact, data.id);
                    } else {
                      this.respond(contact, data.id);
                    }
                  } else if (this.contactFromUuid(data.body.to) != undefined) {
                    this.send(
                      this.contactFromUuid(data.body.to),
                      data.body,
                      "IP"
                    )
                      .then(res => {
                        console.log("punch2");
                        debugger;
                        this.respond(contact, data.id, res.body);
                      })
                      .catch(() => {
                        this.respond(contact, data.id);
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
                      console.log("punch3");
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
                      console.log("punch4");
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
