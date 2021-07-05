const events = require("events");
const net = require("net");
const getPort = require("get-port");
const crypto = require("crypto");
const stream = require("stream");
const isIPv4 = /^::(ffff)?:(?!0)(?!.*\.$)((1?\d?\d|25[0-5]|2[0-4]\d)(\.|$)){4}$/;

/* TODO:
    - Stream inteface
    - Tunneling
 */

class Main {
  constructor(
    self,
    contacts_ = [],
    referrals = [],
    callback = () => {},
    server = false
  ) {
    this.uuid = self.uuid;
    this.priv = self.priv;
    this.pub = self.pub;
    this.ip = self.ip;
    this.port = self.port;
    this.contacts_ = contacts_;
    this.contacts = [];
    this.referrals = referrals;
    this.server = server;
    this.servers = [];
    this.callback = callback;
    this.events = new events.EventEmitter().setMaxListeners(0);
    this.events_ = new events.EventEmitter().setMaxListeners(0);

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
    for (let contact_ of this.contacts_) {
      let contact = new Contact(this, contact_, {});
      this.contacts.push(contact);
      contact.connect().catch(err => {
        console.warn(err);
      });
    }

    console.log(this.uuid + " created");
  }
  addContact(contact_) {
    let contact = new Contact(this, contact_);
    this.contacts.push(contact);
    return contact;
  }
  removeContact(uuid) {
    this.contacts_.splice(
      this.contacts_.indexOf(this.contactFromUuid(uuid)),
      1
    );
    this.contacts.splice(this.contacts.indexOf(this.contactFromUuid(uuid)), 1);
  }
  requestContact(uuid) {
    console.log(uuid);
    let promises = [];
    for (contact of this.contacts) {
      promises.push(
        contact.send(
          {
            to: uuid,
            from: this.uuid,
            pub: this.pub
              .export({ format: "der", type: "pkcs1" })
              .toString("base64")
          },
          "contact_req"
        )
      );
    }
    Promise.allSettled(promises).then(results => {
      results = results.filter(res => res.status == "fulfilled");
      let responses = [...new Set(results.map(res => res.value.body))];
      let awnsers = [];
      if (responses.length == 0) console.log("No responses to contact_req");
      for (res of responses) {
        try {
          res = JSON.parse(res.body);
          for (awnser of res.body) {
            awnsers.push(decrypt(this.priv, awnser));
          }
        } catch {}
      }
      if (this.contactFromUuid(uuid) == undefined) {
        this.callback("contact_req_answers", awnsers).then(res => {
          contact = this.addContact({
            uuid: uuid,
            pub: crypto.createPublicKey({
              key: res.pub,
              format: "der",
              type: "pkcs1",
              encoding: "base64"
            })
          });
          contact.sendIP();
        });
      }
    });
  }

  sendMessage(uuid, message) {
    this.contactFromUuid(uuid).send(message, "message");
  }

  on(type, callback) {
    return this.events.on(type, callback);
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
    /*if (!socket.key) {
      socket.key = crypto.createSecretKey(decrypt(this.priv, raw));
      console.log(decrypt(this.priv, raw));
      console.log(!!socket.key);
    } else*/
    for (let message of splitMessages(raw.toString())) {
      if (message !== "") {
        let remoteAddress = isIPv4.test(socket.remoteAddress)
          ? socket.remoteAddress.replace(/^.*:/, "")
          : socket.remoteAddress;
        let data;
        try {
          message = JSON.parse(message);
          data = JSON.parse(message.message);
        } catch {
          console.log("malformed data");
          return;
        }
        //console.log(data);
        let contact = this.contactFromUuid(data.from);
        // TODO: server
        if (contact != undefined && verify(contact.pub, message)) {
          if (contact.remoteIP != remoteAddress) {
            contact.sendReferrals();
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
                    data.body.encrypted = JSON.parse(data.body.encrypted);
                    let message = JSON.parse(
                      decrypt(this.priv, data.body.encrypted.message)
                    );
                    if (
                      verify(
                        this.contactFromUuid(message.from).pub,
                        data.body.encrypted
                      )
                    ) {
                      //holepunching
                      let contact_to = this.contactFromUuid(message.from);
                      if (!contact_to.connected) {
                        contact_to.localPort = await getPort();
                        if (this.servers.length > 0) {
                          contact_to.localPort = this.servers[0].port;
                        }
                        contact_to.punchHole(message);

                        contact.respond(
                          data.id,
                          JSON.stringify(
                            sign(
                              this.priv,
                              encrypt(
                                contact.pub,
                                JSON.stringify({
                                  ip: this.ip,
                                  port: contact_to.localPort
                                })
                              )
                            )
                          )
                        );
                      } else contact.respond(data.id);
                    } else {
                      contact.respond(data.id);
                    }
                  } else if (this.contactFromUuid(data.body.to) != undefined) {
                    this.contactFromUuid(data.body.to)
                      .send(data.body, "IP")
                      .then(res => {
                        contact.respond(data.id, res.body);
                      })
                      .catch(() => {
                        contact.respond(data.id);
                      });
                  } else if (this.referralFromUuid(data.body.to) != undefined) {
                    let promises;
                    for (let contact_ of this.referralFromUuid(data.body.to)) {
                      promises += contact_.send(data.body, "IP");
                    }
                    Promise.allSettled(promises).then(results => {
                      let responses = [];
                      results.forEach(result => {
                        if (result.status == "fulfilled")
                          responses.push(result.value);
                      });
                      responses = [...new Set(responses)];
                      if (responses.length == 1) responses = responses[0];
                      contact.respond(data.id, responses);
                    });
                  } else if (data.body.hops < 20) {
                    data.body.hops++;
                    let promises = [];
                    for (let contact_ of this.contacts) {
                      if (contact_.uuid != data.from)
                        promises.push(contact_.send(data.body, "IP"));
                    }
                    Promise.allSettled(promises).then(results => {
                      let responses = [];
                      results.forEach(result => {
                        if (result.status == "fulfilled")
                          responses.push(result.value);
                      });
                      responses = [...new Set(responses)];
                      if (responses.length == 1) responses = responses[0];
                      contact.respond(data.id, responses);
                    });
                  }
                  if (this.contacts.length == 1) contact.respond(data.id);
                }
                break;
              case "message":
                {
                  if (data.body != "")
                    contact.push(Buffer.from(data.body, "base64"));
                  contact.respond(data.id);
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
                          contact_.send(data.body, "IP");
                      }
                  }
                  contact.respond(data.id);
                }
                break;
              case "contact_req":
                {
                  if (data.body.to == this.uuid) {
                    data.body = JSON.parse(decrypt(this.priv, data.body));
                    this.callback("contact_req", data.body).then(res => {
                      contact = this.addContact({
                        uuid: data.body.from,
                        pub: crypto.createPublicKey({
                          key: data.body.pub,
                          format: "der",
                          type: "pkcs1",
                          encoding: "base64"
                        })
                      });
                      contact.respond(
                        data.id,
                        JSON.stringify(
                          sign(
                            this.priv,
                            encrypt(
                              contact.pub,
                              JSON.stringify({
                                pub: this.pub.export({
                                  format: "der",
                                  type: "pkcs1"
                                }),
                                phrase: res
                              })
                            )
                          )
                        )
                      );
                    });
                  } else if (this.contactFromUuid(data.body.to) != undefined) {
                    this.contactFromUuid(data.body.to)
                      .send(data.body, "contact_req")
                      .then(res => {
                        contact.respond(data.id, res.body);
                      })
                      .catch(() => {
                        contact.respond(data.id);
                      });
                  } else if (this.referralFromUuid(data.body.to) != undefined) {
                    let promises;
                    for (let contact_ of this.referralFromUuid(data.body.to)) {
                      promises += contact_.send(data.body, "contact_req");
                    }
                    Promise.allSettled(promises).then(results => {
                      let responses = [];
                      results.forEach(result => {
                        if (result.status == "fulfilled")
                          responses.push(result.value);
                      });
                      responses = [...new Set(responses)];
                      if (responses.length == 1) responses = responses[0];
                      contact.respond(data.id, responses);
                    });
                  } else if (data.body.hops < 20) {
                    data.body.hops++;
                    let promises;
                    for (let contact_ of this.contacts) {
                      if (contact_.uuid != data.from)
                        promises += contact_.send(data.body, "contact_req");
                    }
                    Promise.allSettled(promises).then(results => {
                      let responses = [];
                      results.forEach(result => {
                        if (result.status == "fulfilled")
                          responses.push(result.value);
                      });
                      responses = [...new Set(responses)];
                      if (responses.length == 1) responses = responses[0];
                      contact.respond(data.id, responses);
                    });
                  }
                  if (this.contacts.length == 1) contact.respond(data.id);
                }
                break;
              default: {
                contact.respond(data.id);
              }
            }
          }
        }
      }
    }
  }
}
exports.Main = Main;

class Contact extends stream.Duplex {
  constructor(parent, self, options) {
    super(options);
    this.parent = parent;
    this.remoteIP = self.remoteIP;
    this.remotePort = self.remotePort;
    this.pub = self.pub;
    this.uuid = self.uuid;
    this.try = 0;
  }
  _write(chunk) {
    this.send(chunk.toString("base64"), "message");
  }
  _read() {}
  send(message, type) {
    return new Promise((resolve, reject) => {
      //console.log("write");
      let responded = false;
      let id = Math.floor(Math.random() * 10000);
      console.log({
        from: this.parent.uuid,
        type: type,
        body: message,
        id: id,
        ip: this.remoteIP,
        port: this.remotePort
      });
      this.socket.write(
        JSON.stringify(
          sign(
            this.parent.priv,
            JSON.stringify({
              from: this.parent.uuid,
              type: type,
              body: message,
              id: id,
              ip: this.remoteIP,
              port: this.remotePort
            })
          )
        )
      );

      this.parent.events_.prependOnceListener("id-" + id, data => {
        responded = true;
        resolve(data);
      });
      this.socket.on("error", err => {
        debugger;
        this.connected = false;
        this.parent.events_.removeAllListeners("id-" + id);
        console.log("send from " + this.parent.uuid + err);
        this.connect().then(() => {
          this.send(message, type)
            .then(res => resolve(res))
            .catch(err => reject(err));
        });
      });
      setTimeout(() => {
        if (!responded) {
          this.parent.events_.removeAllListeners("id-" + id);
          reject("timeout");
        }
      }, 60000);
    });
  }
  respond(id, message = "") {
    //console.log("respond");
    return new Promise((resolve, reject) => {
      //console.log("write");
      console.log({
        from: this.parent.uuid,
        body: message,
        res: id,
        ip: this.remoteIP,
        port: this.remotePort
      });
      this.socket.write(
        JSON.stringify(
          sign(
            this.parent.priv,
            JSON.stringify({
              from: this.parent.uuid,
              body: message,
              res: id,
              ip: this.remoteIP,
              port: this.remotePort
            })
          )
        )
      );

      this.socket.on("error", err => {
        debugger;
        console.warn(err);
        this.connect(contact).then(() => {
          this.respond(id, message)
            .then(res => resolve(res))
            .catch(err => reject(err));
        });
      });
    });
  }
  connect() {
    return new Promise((resolve, reject) => {
      //console.log("createConnection");
      if (this.socket && !this.socket.destroyed && !this.socket._hadError) {
        this.send("", "message");
      } else {
        if (!this.parent.servers.find(server => this.port == server.port)) {
          this.socket = net.createConnection({
            port: this.remotePort,
            host: this.remoteIP
          });
          this.socket.setKeepAlive(true);
          this.socket.on("ready", () => {
            this.send("", "message");
            resolve();
          });
          this.socket.on("data", data => {
            this.parent.handle_in(this.socket, data);
          });
          this.socket.on("error", err => {
            if (
              this.connected &&
              this.parent.referralFromUuid(this.uuid) != undefined
            ) {
              this.parent.referrals.splice(
                this.parent.referrals.indexOf(this.referralFromUuid(this.uuid)),
                1
              );
              this.sendReferrals(true);
            }

            this.connected = false;
            this.try++;
            if (this.try < 10) {
              setTimeout(() => {
                this.connect().catch(err => {
                  reject(err);
                });
              }, 10);
            } else if (this.try < 20) {
              this.sendIP();
            } else console.log(err);
          });
          this.socket.on("timeout", () => {
            if (
              this.connected &&
              this.parent.referralFromUuid(this.uuid) != undefined
            ) {
              this.parent.referrals.splice(
                this.parent.referrals.indexOf(
                  this.parent.referralFromUuid(this.uuid)
                ),
                1
              );
              this.sendReferrals(true);
            }
            this.connected = false;
            console.log("timeout");
            this.socket.end();
            this.try++;
            if (this.try < 20) {
              this.connect(contact).catch(err => {
                reject(err);
              });
            } else if (this.try < 50) {
              this.sendIP();
            } else console.log(err);
          });
        }
      }
    });
  }
  async sendIP() {
    console.log("sendIP for " + this.uuid + " from " + this.parent.uuid);
    this.localPort = await getPort();
    console.log(this.localPort);
    if (this.parent.servers.length > 0) {
      this.localPort = this.parent.servers[0].port;
    }
    let promises = [];
    for (let contact of this.parent.contacts) {
      if (
        contact.connected &&
        contact.uuid != this.uuid &&
        contact.socket &&
        !contact.socket.destroyed &&
        !contact.socket._hadError
      )
        promises.push(
          contact.send(
            {
              to: this.uuid,
              hops: 0,
              encrypted: JSON.stringify(
                sign(
                  this.parent.priv,
                  encrypt(
                    this.pub,
                    JSON.stringify({
                      from: this.parent.uuid,
                      IP: this.parent.ip,
                      port: this.localPort
                    })
                  )
                )
              )
            },
            "IP"
          )
        );
    }
    Promise.allSettled(promises).then(results => {
      results = results.filter(res => res.status == "fulfilled");
      let responses = [...new Set(results.map(res => res.value.body))];
      if (responses.length == 0) console.log("No responses to IP");
      let awnsers = [];
      for (let res of responses) {
        try {
          let awnser = JSON.parse(res);
          console.log(awnser);
          awnser.message = decrypt(this.parent.priv, awnser.message);
          console.log(awnser);
          if (typeof awnser !== "array") awnser = [awnser];
          awnsers.push(awnser);
        } catch {
          console.log("Error");
        }
      }
      let res = [...new Set(awnsers)];
      for (awnser of res) {
        if (res != "" && verify(contact.pub, awnser))
          this.punchHole(JSON.parse(awnser.message), 10);
      }
    });
  }
  sendReferrals(rm = false) {
    let uuid = this.uuid;
    for (let contact of this.parent.contacts) {
      if (contact.connected)
        this.send(
          {
            referent: uuid,
            hops: 1,
            rm: rm
          },
          "referral"
        );
    }
  }
  punchHole(data, timeout = 0) {
    let port = this.localPort + 1;
    port--;
    if (!this.connected) {
      setTimeout(() => {
        console.log("punch on " + port);
        let socket = net.createConnection({
          host: data.ip,
          port: data.port,
          localPort: port,
          timeout: 100
        });
        socket.on("data", data => {
          this.parent.handle_in(socket, data);
        });
        socket.on("ready", () => {
          console.log("client: " + this.parent.uuid);
          this.socket = socket;
          this.send("", "message");
        });
        socket.on("error", err => {
          console.log(err);
        });
        socket.on("close", err => {
          console.log("server: " + this.parent.uuid);
          debugger;
          if (
            !this.parent.servers.find(server => server.port == this.localPort)
          ) {
            let server = net.createServer(socket => {
              socket.on("ready", () => {
                this.connected = true;
                this.socket = socket;
              });
              socket.on("data", data => {
                if (!this.parent.servers.find(server_ => server == server_))
                  this.parent.servers.push(server);

                this.parent.handle_in(socket, data);
              });
              socket.on("error", err => {
                console.log("holepunch error: " + err);
                this.connected = false;
                this.parent.servers.splice(
                  this.parent.servers.indexOf(
                    this.parent.servers.find(server_ => server == server_)
                  ),
                  1
                );
              });
            });
            server.listen(port);
            this.parent.servers.push({
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
}

function sign(key, message) {
  if (typeof message === "object") message = JSON.stringify(message);
  let sign = crypto.createSign("SHA256");
  sign.write(message);
  sign.end();
  sig = sign.sign(key, "base64");
  return { sig, message };
}

function verify(key, { sig, message }) {
  let verify = crypto.createVerify("SHA256");
  verify.write(message);
  verify.end();
  return verify.verify(key, sig, "base64");
}

function encrypt(key, message) {
  //return message;
  let result = crypto
    .publicEncrypt(
      {
        key: key,
        padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: "sha256"
      },
      Buffer.from(message)
    )
    .toString("base64");
  return result;
}

function decrypt(key, message) {
  //return message;
  message = crypto.privateDecrypt(
    {
      key: key,
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: "sha256"
    },
    Buffer.from(message, "base64")
  );
  console.log(message);
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
