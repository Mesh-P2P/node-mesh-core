const events = require("events");
const net = require("net");
const getPort = require("get-port");
const crypto = require("crypto");
const stream = require("stream");
const isIPv4 = /^::(ffff)?:(?!0)(?!.*\.$)((1?\d?\d|25[0-5]|2[0-4]\d)(\.|$)){4}$/;

// TODO: message id (IP,contact_req); cleanup/comments; encryption

/**
 * The Interface
 * @param {Object} self - this Peer
 * @param {string} self.uuid - its uuid
 * @param {PublicKey} self.pub - its public key (RSA)
 * @param {PrivateKey} self.priv - its private key (RSA)
 * @param {string} self.ip
 * @param {number} self.port
 * @param {Object[]} contacts_ - Contacts
 * @param {string} contacts_.uuid - its uuid
 * @param {PublicKey} contacts_.pub - its public key (RSA)
 * @param {string} contacts_.remoteIP - its IP address
 * @param {number} contacts_.remotePort - its port
 * @param {Object[]} referrals - Referrals
 * @param {Function} callback - callback promise that handles contact requests ("contact_req", "contact_req_answers")
 * @param {boolean} server - is server (optional)
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
  /**
   * adds a contact to contacts
   * @param {Object} contact_ - Contact information
   * @param {string} contact_.uuid - its uuid
   * @param {PublicKey} contact_.pub - its public key (RSA)
   * @param {string} contact_.remoteIP - its IP address
   * @param {number} contact_.remotePort - its port
   * @returns {Object} the Contact
   */
  addContact(contact_) {
    let contact = new Contact(this, contact_);
    this.contacts.push(contact);
    return contact;
  }
  /**
   * removes a contact from contacts
   * @param {string} uuid
   */
  removeContact(uuid) {
    this.contacts_.splice(
      this.contacts_.indexOf(this.contactFromUuid(uuid)),
      1
    );
    this.contacts.splice(this.contacts.indexOf(this.contactFromUuid(uuid)), 1);
  }
  /**
   * Handles addition of a contact
   * @param {string} uuid
   * @param {SecretKey} key - A secret key
   */
  async requestContact(uuid, key) {
    let promises = [];
    console.log(
      this.pub.export({ format: "der", type: "pkcs1" }).toString("base64")
    );
    debugger;
    sym_encrypt(
      key,
      JSON.stringify({
        pub: this.pub
          .export({ format: "der", type: "pkcs1" })
          .toString("base64"),
        from: this.uuid
      })
    ).then(encrypted => {
      for (let contact of this.contacts) {
        promises.push(
          contact.send(
            {
              to: uuid,
              hops: 0,
              encrypted: encrypted
            },
            "contact_req"
          )
        );
      }
      Promise.allSettled(promises).then(results => {
        results = results.filter(res => res.status == "fulfilled");
        let responses = [...new Set(results.map(res => res.value.body))];
        if (responses.length == 0) console.log("No responses to contact_req");
        for (let res of responses) {
          try {
            for (let awnser of res) {
              sym_decrypt(key, awnser).then(message => {
                console.log(
                  this.pub
                    .export({
                      format: "der",
                      type: "pkcs1"
                    })
                    .toString("base64")
                );
                if (this.contactFromUuid(uuid) == undefined) {
                  let contact = this.addContact({
                    uuid: uuid,
                    pub: crypto.createPublicKey({
                      key: message,
                      format: "der",
                      type: "pkcs1",
                      encoding: "base64"
                    })
                  });
                  contact.sendIP();
                }
              });
            }
          } catch {}
        }
      });
    });
  }
  on(type, callback) {
    return this.events.on(type, callback);
  }
  /**
   * get contact from its uuid
   * @param {string} uuid
   * @return {Contact} Contact
   */
  contactFromUuid(uuid) {
    return this.contacts.find(contact => {
      return contact.uuid == uuid;
    });
  }
  /**
   * get referral from its uuid
   * @param {string} uuid
   * @return {Object} Referral
   */
  referralFromUuid(uuid) {
    return this.referrals.find(referral => {
      return referral.referent == uuid;
    });
  }
  /**
   * get contact from its IP
   * @param {string} IP
   * @returns {Contact} Contact
   */
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
                  data.body.hops++;
                  if (data.body.to == this.uuid) {
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
                        console.log(
                          sign(
                            this.priv,
                            encrypt(
                              contact_to.pub,
                              JSON.stringify({
                                ip: this.ip,
                                port: contact_to.localPort
                              })
                            )
                          )
                        );
                        contact.respond(
                          data.id,
                          sign(
                            this.priv,
                            encrypt(
                              contact_to.pub,
                              JSON.stringify({
                                ip: this.ip,
                                port: contact_to.localPort
                              })
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
                          responses.push(result.value.body);
                      });
                      responses = [...new Set(responses)];
                      if (responses.length == 1) responses = responses[0];
                      contact.respond(data.id, responses);
                    });
                  } else if (data.body.hops < 20) {
                    let promises = [];
                    for (let contact_ of this.contacts) {
                      if (contact_.uuid != data.from)
                        promises.push(contact_.send(data.body, "IP"));
                    }
                    Promise.allSettled(promises).then(results => {
                      let responses = [];
                      results.forEach(result => {
                        if (result.status == "fulfilled")
                          responses.push(result.value.body);
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
                  data.body.hops++;
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
                  data.body.hops++;
                  if (data.body.to == this.uuid) {
                    this.callback("contact_req", data.body.encrypted).then(
                      res => {
                        res.body = JSON.parse(res.body);
                        console.log(res.body.pub);
                        this.addContact({
                          uuid: res.body.from,
                          pub: crypto.createPublicKey({
                            key: res.body.pub,
                            format: "der",
                            type: "pkcs1",
                            encoding: "base64"
                          })
                        });
                        console.log(
                          this.pub
                            .export({
                              format: "der",
                              type: "pkcs1"
                            })
                            .toString("base64")
                        );
                        sym_encrypt(
                          res.key,
                          this.pub
                            .export({
                              format: "der",
                              type: "pkcs1"
                            })
                            .toString("base64")
                        ).then(encrypted =>
                          contact.respond(data.id, encrypted)
                        );
                      }
                    );
                  } else if (this.contactFromUuid(data.body.to) != undefined) {
                    this.contactFromUuid(data.body.to)
                      .send(data.body, "contact_req")
                      .then(res => {
                        console.log(res);
                        contact.respond(data.id, res.body);
                      })
                      .catch(() => {
                        contact.respond(data.id);
                      });
                  } else if (this.referralFromUuid(data.body.to) != undefined) {
                    console.log("req");
                    let promises;
                    for (let contact_ of this.referralFromUuid(data.body.to)) {
                      promises += contact_.send(data.body, "contact_req");
                    }
                    Promise.allSettled(promises).then(results => {
                      let responses = [];
                      results.forEach(result => {
                        if (result.status == "fulfilled")
                          responses.push(result.value.body);
                      });
                      responses = [...new Set(responses)];
                      contact.respond(data.id, responses);
                    });
                  } else if (data.body.hops < 20) {
                    let promises = [];
                    for (let contact_ of this.contacts) {
                      if (contact_.uuid != data.from)
                        promises.push(contact_.send(data.body, "contact_req"));
                    }
                    Promise.allSettled(promises).then(results => {
                      let responses = [];
                      results.forEach(result => {
                        if (result.status == "fulfilled")
                          responses.push(result.value.body);
                      });
                      responses = [...new Set(responses)];
                      contact.respond(data.id, responses);
                    });
                  }
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
/**
 * a Contact
 * @param {Object} parent - the parent Class
 * @param {Object} self - information about itself
 * @param {string} self.uuid - its uuid
 * @param {PublicKey} self.pub - its public key (RSA)
 * @param {string} self.remoteIP - its IP address
 * @param {number} self.remotePort - its port
 */
class Contact extends stream.Duplex {
  constructor(parent, self, options) {
    super(options);
    this.parent = parent;
    this.remoteIP = self.remoteIP;
    this.remotePort = self.remotePort;
    this.pub = self.pub;
    this.uuid = self.uuid;
    this.try = 0;
    this.connected = false;
  }
  _write(chunk) {
    this.send(chunk.toString("base64"), "message");
  }
  _read() {}
  /**
   * send a message to this Contact
   * @param {any} message - the message to be sent
   * @param {string} type - the type of the message
   * @returns {Promise} a Promise that resolves with the response
   */
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
        ip: this.socket.remoteAddress,
        port: this.socket.remotePort
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
              ip: this.socket.remoteAddress,
              port: this.socket.remotePort
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
        responded = true;
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
  /**
   * Responds to a message
   * @param {number} id - the message id
   * @param {any} message - what to respond with
   */
  respond(id, message = "") {
    //console.log("respond");
    return new Promise((resolve, reject) => {
      //console.log("write");
      console.log({
        from: this.parent.uuid,
        body: message,
        res: id,
        ip: this.socket.remoteAddress,
        port: this.socket.remotePort
      });
      this.socket.write(
        JSON.stringify(
          sign(
            this.parent.priv,
            JSON.stringify({
              from: this.parent.uuid,
              body: message,
              res: id,
              ip: this.socket.remoteAddress,
              port: this.socket.remotePort
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
  /**
   * connect to this contact
   */
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
  /**
   * send IP messages to all contacts for this contact
   */
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
              encrypted: sign(
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
          if (verify(this.pub, res)) {
            res.message = decrypt(this.parent.priv, res.message).toString();
            awnsers.push(res);
          }
        } catch {
          console.log("Error");
        }
      }
      let res = [...new Set(awnsers)];
      for (let awnser of res) {
        if (res != "") {
          this.punchHole(JSON.parse(awnser.message), 100);
        }
      }
    });
  }
  /**
   * send referral message about this contact to all contacts
   * @param {boolean} rm - send as Remove referral message
   */
  sendReferrals(rm = false) {
    let uuid = this.uuid;
    for (let contact of this.parent.contacts) {
      if (contact.connected)
        contact.send(
          {
            referent: uuid,
            hops: 1,
            rm: rm
          },
          "referral"
        );
    }
  }
  /**
   * do holepunching with this contact
   * @param {Object} data
   * @param {string} data.ip - this contact's IP address
   * @param {number} data.port - this contact's port
   * @param {number} timeout
   */
  punchHole(data, timeout = 0) {
    console.log(data);
    let port = this.localPort + 1;
    port--;
    if (
      !this.parent.servers.find(server => server.port == port) &&
      !this.connected
    ) {
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
        });
      }, timeout);
    } else console.log("already listening on port " + port);
  }
}
/**
 * sing a message
 * @param {PrivateKey} key - the private key
 * @param {any} message - the message to sing
 * @param {string} algorithm - the algorithm to use
 * @returns {Object} signed message with signature (with sig and message)
 */
function sign(key, message, algorithm = "SHA256") {
  if (typeof message === "object") message = JSON.stringify(message);
  let sign = crypto.createSign(algorithm);
  sign.write(message);
  sign.end();
  sig = sign.sign(key, "base64");
  return { sig, message };
}
/**
 * verify a signed message
 * @param {PublicKey} key - the public key
 * @param {Object} signed_message
 * @param {String} signed_message.sig - the signature
 * @param {String} signed_message.message - the message
 * @param {String} algorithm - the algorithm to use
 * @returns {boolean} - true if the signature is valid
 */
function verify(key, { sig, message }, algorithm = "SHA256") {
  let verify = crypto.createVerify(algorithm);
  verify.write(message);
  verify.end();
  return verify.verify(key, sig, "base64");
}
/**
 * encrypt with symmetric key
 * @param {SecretKey} key - the symmetric key
 * @param {string} message
 * @returns {Object} returns {message, iv}
 */
function sym_encrypt(key, message) {
  return new Promise((resolve, reject) => {
    const iv = crypto.randomFillSync(new Uint8Array(16));
    const cipher = crypto.createCipheriv("AES256", key, iv);

    let encrypted = "";
    cipher.setEncoding("base64");
    cipher.on("data", chunk => (encrypted += chunk));
    cipher.on("end", () =>
      resolve({ message: encrypted, iv: Buffer.from(iv).toString("base64") })
    );

    cipher.write(message);
    cipher.end();
  });
}
/**
 * decrypt with symmetric key
 * @param {SecretKey} key - the symmetric key
 * @param {Object} encrypted_message - the encrypted message with iv
 * @param {string} encrypted_message.iv
 * @param {string} encrypted_message.message
 * @returns {Promise} - Promise that resolves with the decrypted message
 */
function sym_decrypt(key, { iv, message }) {
  return new Promise((resolve, reject) => {
    iv = Buffer.from(iv, "base64");
    const decipher = crypto.createDecipheriv("AES256", key, iv);

    let decrypted = "";

    decipher.on("data", chunk => (decrypted += chunk));
    decipher.on("end", () => {
      resolve(decrypted);
    });

    decipher.write(message, "base64");
    decipher.end();
  });
}
/**
 * RSA encrypt
 * @param {PrivateKey} key - the private key (RSA)
 * @param {string} message
 * @returns {string} encrypted message
 */
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
/**
 * RSA decrypt
 * @param {PublicKey} key - the public key (RSA)
 * @param {string} message - encrypted message
 * @return {string} decrypted message
 */
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
/**
 * split a string into json strings
 * @param {string} data - the string to be split
 * @returns {string[]} json strings
 */
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
