const events = require("events");
const net = require("net");
const getPort = require("get-port");
const crypto = require("crypto");
const isIPv4 = /^::(ffff)?:(?!0)(?!.*\.$)((1?\d?\d|25[0-5]|2[0-4]\d)(\.|$)){4}$/;

/* TODO:
    - Stream inteface
    - Tunneling
 */

class Main {
  constructor(
    self,
    contacts = [],
    referrals = [],
    callback = () => {},
    server = false
  ) {
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
    this.callback = callback;
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
  addContact(contact) {
    this.contacts.push(contact);
    return contact;
  }
  removeContact(uuid) {
    this.contacts.splice(this.contacts.indexOf(this.contactFromUuid(uuid)), 1);
  }
  requestContact(uuid) {
    cosole.log(uuid);
    let promises = [];
    for (contact of this.contacts) {
      promises.push(
        this.send(
          contact,
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
            awnsers.push(this.decrypt(this.priv, awnser));
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
          this.sendIP(contact);
        });
      }
    });
  }
  send(contact, message, type) {
    return new Promise((resolve, reject) => {
      //console.log("write");
      let responded = false;
      let id = Math.floor(Math.random() * 10000);
      console.log({
        from: this.uuid,
        type: type,
        body: message,
        id: id,
        ip: contact.remoteIP,
        port: contact.remotePort
      });
      contact.socket.write(
        JSON.stringify(
          sign(
            this.priv,
            JSON.stringify({
              from: this.uuid,
              type: type,
              body: message,
              id: id,
              ip: contact.remoteIP,
              port: contact.remotePort
            })
          )
        )
      );

      this.events_.prependOnceListener("id-" + id, data => {
        responded = true;
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
      setTimeout(() => {
        if (!responded) {
          this.events_.removeAllListeners("id-" + id);
          reject("timeout");
        }
      }, 60000);
    });
  }
  respond(contact, id, message = "") {
    //console.log("respond");
    return new Promise((resolve, reject) => {
      //console.log("write");
      console.log({
        from: this.uuid,
        body: message,
        res: id,
        ip: contact.remoteIP,
        port: contact.remotePort
      });
      contact.socket.write(
        JSON.stringify(
          sign(
            this.priv,
            JSON.stringify({
              from: this.uuid,
              body: message,
              res: id,
              ip: contact.remoteIP,
              port: contact.remotePort
            })
          )
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
    let promises = [];
    for (let contact of this.contacts) {
      if (
        contact.connected &&
        contact.uuid != contact_to.uuid &&
        contact.socket &&
        !contact.socket.destroyed &&
        !contact.socket._hadError
      )
        promises.push(
          this.send(
            contact,
            {
              to: contact_to.uuid,
              hops: 0,
              encrypted: JSON.stringify(
                sign(
                  this.priv,
                  encrypt(
                    contact_to.pub,
                    JSON.stringify({
                      from: this.uuid,
                      IP: this.ip,
                      port: contact_to.localPort
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
          let awnser = JSON.parse(res.body);
          awnser.message = this.decrypt(this.priv, awnser.message);
          if (typeof awnser !== "array") awnser = [awnser];
          awnsers.push(awnser);
        } catch {}
      }
      let res = [...new Set(awnsers)];
      for (awnser of res) {
        if (res != "" && verify(contact.pub, awnser))
          this.punchHole(contact_to, JSON.parse(awnser.message), 10);
      }
    });
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
                        this.punchHole(contact_to, message);

                        this.respond(
                          contact,
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
                      this.respond(contact, data.id, responses);
                    });
                  } else if (data.body.hops < 20) {
                    data.body.hops++;
                    let promises = [];
                    for (let contact_ of this.contacts) {
                      if (contact_.uuid != data.from)
                        promises.push(this.send(contact_, data.body, "IP"));
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
                      this.respond(
                        contact,
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
                    this.send(
                      this.contactFromUuid(data.body.to),
                      data.body,
                      "contact_req"
                    )
                      .then(res => {
                        this.respond(contact, data.id, res.body);
                      })
                      .catch(() => {
                        this.respond(contact, data.id);
                      });
                  } else if (this.referralFromUuid(data.body.to) != undefined) {
                    let promises;
                    for (let contact_ of this.referralFromUuid(data.body.to)) {
                      promises += this.send(contact_, data.body, "contact_req");
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
                        promises += this.send(
                          contact_,
                          data.body,
                          "contact_req"
                        );
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
              default: {
                this.respond(contact, data.id);
              }
            }
          }
        }
      }
    }
  }
}
exports.Main = Main;

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
