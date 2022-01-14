const events = require("events");
const net = require("net");
const getPort = require("get-port");
const crypto = require("crypto");
const stream = require("stream");
const tls = require("tls");
const pem = require("pem");
const isIPv4 =
  /^::(ffff)?:(?!0)(?!.*\.$)((1?\d?\d|25[0-5]|2[0-4]\d)(\.|$)){4}$/;
const sha256 = crypto.createHash('sha256')

// TODO: compact; priority levels (contacts); major refactor

/**
 * The Interface
 * @param {Object} options
 * @param {string} options.uuid - uuid
 * @param {PublicKey} options.pub - public key (RSA)
 * @param {PrivateKey} options.priv - private key (RSA)
 * @param {Object[]} addons - array of optional addons
 * @param {Function[]} addons.functions - array of additional functions
 * @param {Object[]} addons.types - array of additional message types
 * @param {number} addon.types.id - type id
 * @param {string} addon.types.name
 * @param {Function} addon.types.rx - function called receiving message type
 * @param {Function} addon.types.tx - function for sending message type
 * @param {Object[]} addons.types.types - Array of subtypes (same as types)
 * @param {Object[]} contacts_ - Contacts initializers
 * @param {string} contacts_.uuid - its uuid
 * @param {PublicKey} contacts_.pub - its public key (RSA)
 * @param {string} contacts_.remoteIP - its IP address
 * @param {number} contacts_.remotePort - its port
 * @param {Object[]} contacts - contact classes
 * @param {Object[]} referrals - Referrals
 * @param {Function} callback - callback promise that handles contact requests ("contact_req", "contact_req_answers")
 */
class Main {
  current_requests = [];
  constructor(
    options,
    addons = [],
    contacts_ = [],
    contacts = [],
    callback = () => {}
  ) {
    this.addons = addons;
    this.msgTypes = {
      0: {
        rx: this.onResponse,
        tx: this.sendResponse,
      },
      1: {
        rx: this.onDirect,
        tx: this.sendDirect,
      },
      2: {
        rx: this.onConfig,
        tx: this.sendConfig,
        0: {
          rx: this.onJsonConfig,
          tx: this.sendJsonConfig,
        },
        1: {
          rx: this.onDistance,
          tx: this.sendDistance,
        },
        2: {
          rx: this.onDistanceWithoutSelf,
          tx: this.sendDistanceWithoutSelf,
        },
      },
      3: {
        rx: this.onBroadcast,
        tx: this.sendBroadcast,
      },
      4: {
        rx: this.onRoute,
        tx: this.sendRoute,
        0: {
          rx: this.onConnect,
          tx: this.sendConnect,
        },
        1: {
          rx: this.onContactRequest,
          tx: this.sendContactRequest,
        },
      },
    };
    this.options = options;
    this.uuid = options.uuid;
    this.priv = crypto.createPrivateKey(options.priv);
    this.cert = options.cert;
    this.pub = crypto.createPublicKey(options.pub);
    this.contacts_ = contacts_;
    this.contacts = contacts;
    this.distances = {}; // {'uuid':{min,'uuid': {distance, contact}}}
    this.servers = [];
    this.msgHashes = [];
    this.callback = callback;
    this.events = new events.EventEmitter().setMaxListeners(0);
    this.events_ = new events.EventEmitter().setMaxListeners(0);

    for (addon of addons) this.initAddon(addon, addon);

    // try (unencrypted) server on 7575 else connect to 7575
    // udp broadcast

    for (let contact_ of this.contacts_) {
      let contact = new Contact(this, contact_, {});
      this.contacts.push(contact);
      contact.connect().catch((err) => {
        console.warn(err);
      });
    }

    console.log(this.uuid + " created");
  }
  /**
   * receiving Response (0)
   * @param {Buffer} message
   * @param {number} id
   * @param {Contact} contact
   */
  onResponse(message, id, contact) {
    contact.emit("id-" + id, message);
  }
  /**
   * send response (0)
   * @param {Buffer} message
   * @param {Buffer} id
   * @param {number} status
   * @param {Contact} contact
   */
  sendResponse(message, id, contact) {
    contact.send(Buffer.concat([message]), 0, false, id)
  }
  /**
   * receiving Direct message (1)
   * @param {Buffer} message
   * @param {number} id
   * @param {Contact} contact
   */
  onDirect(message, id, contact) {
    contact.push(message);
  }
  /**
   * send Direct message (1)
   * @param {Buffer} message 
   * @param {Contact} contact 
   */
  sendDirect(message, contact) {
    contact.send(message, 1, false)
  }
  /**
   * receiving Config message (2)
   * @param {Buffer} message
   * @param {number} id
   * @param {Contact} contact
   */
  onConfig(message, id, contact) {
    let type = message.slice(0, 1).readUInt8();
    message = message.slice(1);
    this.msgTypes[2][type].rx(message, id, contact);
  }
  /**
   * send Config message (2)
   * @param {Buffer} message 
   * @param {number} type 
   * @param {Contact} contact 
   * @param {boolean} addEventListener (optional) - false on default
   */
  sendConfig(message, type, contact, addEventListener = false) {
    contact.send(Buffer.concat([Buffer.allocunsafe(1).writeUInt8(type), message]), 2, addEventListener)
  }
  /**
   * receiving Distance message (2.0)
   * @param {Buffer} message
   * @param {number} id
   * @param {Contact} contact
   */
  onJsonConfig(message, id, contact) {
    message = JSON.parse(message);
  }
  /**
   * send JSON Config message (2.0)
   * @param {Object} options 
   * @param {Contact} contact 
   */
  sendJsonConfig(options, contact) {
    contact.parent.msgTypes[2].tx(Buffer.from(JSON.stringify(options)), 0, contact)
  }
  /**
   * receiving Distance message (2.1)
   * @param {Buffer} message
   * @param {number} id
   * @param {Contact} contact
   */
  onDistance(message, id, contact) {
    let uuid = message.slice(0, 16);
    let distance = message.slice(16);
  }
  /**
   * send Distance message (2.1)
   * @param {number} distance 
   * @param {Buffer} uuid 
   * @param {Contact} contact 
   */
  sendDistance(distance, uuid, contact) {
    contact.parent.msgTypes[2].tx(Buffer.concat([uuid, Buffer.allocunsafe(1).writeUInt8(distance)]), 1, contact)
  }
  /**
   * receiving Distance without self message (2.2)
   * @param {Buffer} message
   * @param {number} id
   * @param {Contact} contact
   */
  onDistanceWithoutSelf(message, id, contact) {
    let uuid = message;
  }
  /**
   * send Distance without self message (2.2)
   * @param {Buffer} uuid 
   * @param {Contact} contact 
   */
  sendDistanceWithoutSelf(uuid, contact) {
    contact.parent.msgTypes[2].tx(uuid, 2, contact)
  }
  /**
   * receiving Broadcast message (3)
   * @param {Buffer} message
   * @param {number} id
   * @param {Contact} contact
   */
  onBroadcast(message, id, contact) {
    let ttl = message.slice(0, 1).readUInt8();
    let type = message.slice(1, 2).readUInt8();
    message = message.slice(2);

    let hashes = contact.parent.msgHashes;
    let hash = sha256.update(message).digest();
    if (hashes.indexOf(hash) !== -1) {
      contact.parent.msgTypes[0].tx(Buffer.alloc(0), id, contact)
      return
    }
    hashes.push(hash);
    setTimeout(() => {
      if (hashes.indexOf(hash) !== -1) hashes.splice(hashes.indexOf(hash), 1);
    }, 120000)

    this.msgTypes[3][type].rx(message, id, contact);
    if (ttl > 0) {
      ttl--
      let promises = [];

      contact.parent.contacts.forEach(contact_ => {
        if (contact_ != contact) promises.push(
          contact_.send(Buffer.concat([
            Buffer.allocunsafe(1).writeUInt8(ttl),
            Buffer.allocunsafe(1).writeUInt8(type),
            message
          ])))
      })
      Promise.allSettled(promises).then(results => {
        results = results.map(result => result.value);
        results = results.map(result => {
          if (result.length < 2) return result
          let resArray = []
          let done = false;
          while (result.length > 0) {
            let length = result.slice(0, 2).readBigInt16BE();
            let message = result.slice(2, length + 2);
            resArray.push(message)
            result = result.slice(length + 2)
          }
          return resArray
        })
        results = results.flat()

        results = [...new Set(results)];

        //Bufferize
        contact.parent.msgTypes[0].tx(results, id, contact)
      })
    }

  }
  /**
   * send Broadcast message (3)
   * @param {Buffer} message 
   * @param {number} type 
   * @param {Main} self 
   */
  sendBroadcast(message, type, self) {
    let ttl = Buffer.allocunsafe(1).writeUInt8(crypto.randomInt(self.options.ttlVariation || 2) + self.options.minttl || 5)
    let buffer = Buffer.concat([ttl, Buffer.allocunsafe(1).writeUInt8(type), message])
    let promises = [];
    self.contacts.forEach(contact => {
      promises.push(contact.send(buffer, 3))
    })
  }
  /**
   * receiving Route message (4)
   * @param {Buffer} message
   * @param {number} id
   * @param {Contact} contact
   */
  onRoute(message, id, contact) {
    let ttl = message.slice(0, 1).readUInt8();
    let receiver = message.slice(1, 17);
    let type = message.slice(17, 18).readUInt8();
    message = message.slice(18);
    this.msgTypes[4][type].rx(message, id, contact);
  }
  /**
   * send Route message (4)
   * @param {Buffer} message 
   * @param {number} type 
   * @param {Contact} contact 
   */
  sendRoute(message, type, contact) {
    let uuid = typeof contact === 'string' ? contact : contact.uuid;
    let ttl = Buffer.allocunsafe(1).writeUInt8(crypto.randomInt(self.options.ttlVariation || 2) + self.options.minttl || 5)
    let buffer = Buffer.concat([ttl, uuid, Buffer.allocunsafe(1).writeUInt8(type), message])
  }
  /**
   * receiving Connect message (4.0)
   * @param {Buffer} message
   * @param {number} id
   * @param {Contact} contact
   */
  onConnect(message, id, contact) {
    //signature
    //decrypt asym
    let type = message.slice(0, 1).readUInt8();
    let uuid = message.slice(1, 17);
    let port = message.slice(17, 18).readUInt16BE();
    //ip
  }
  /**
   * send Connect message (4.0)
   * @param {Contact} contact
   */
  sendConnect(contact) {
    //port; ip
    contact.parent.msgTypes[4].tx(Buffer.concat([contact.parent.uuid, port, ip]), 2, contact)
  }
  /**
   * receiving Contact Request message (4.1)
   * @param {Buffer} message
   * @param {number} id
   * @param {Contact} contact
   */
  onContactRequest(message, id, contact) {
    // decrypt sym
    let uuid = message.slice(0, 16);
    let pub = message.slice(16);
  }
  /**
   * send Contact Request message (4.1)
   * @param {Buffer} uuid 
   * @param {Key} key 
   * @param {Main} self 
   */
  sendContactRequest(uuid, key, self) {
    let buffer = Buffer.concat([self.uuid, self.pub]) // pub needs to be buffer
    //encrypt buffer
    contact.parent.msgTypes[2].tx(buffer, 2, uuid)
  }
  /**
   * adds Addon msgTypes to this.msgTypes
   * @param {Object} addon
   * @param {Object} main
   * @param {Object} root - (optional) where to add the msgTypes (used for subtypes)
   */
  initAddon(addon, main, root = this.msgTypes) {
    for (type of addon.types) {
      if (root[type.id]) {
        if (addon.rx)
          throw new Error(
            `Addon ${type.name} wants add message type ${type.id} in ${main.name} (${main.id}) but it already exists`
          );
        initAddon(type, main, root[type.id]);
      } else {
        root[type.id].addon = main;
        root[type.id].rx = type.rx;
        root[type.id].tx = type.tx;
        initAddon(type, main, root[type.id]);
      }
    }
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
    let id = Math.floor(Math.random() * 1000);
    console.log(this.cert);
    debugger;
    sym_encrypt(
      key,
      JSON.stringify({
        cert: this.cert,
        from: this.uuid,
      })
    ).then((encrypted) => {
      for (let contact of this.contacts) {
        promises.push(
          contact.send(
            {
              to: uuid,
              hops: 0,
              encrypted: encrypted,
              id,
            },
            "contact_req"
          )
        );
      }
      Promise.allSettled(promises).then((results) => {
        results = results.filter((res) => res.status == "fulfilled");
        let responses = [...new Set(results.map((res) => res.value.body))];
        if (responses.length == 0) console.log("No responses to contact_req");
        for (let res of responses) {
          try {
            if (typeof res !== "array") res = [res];
            for (let awnser of res) {
              if (awnser != "")
                sym_decrypt(key, awnser).then((message) => {
                  console.log(
                    this.pub
                      .export({
                        format: "der",
                        type: "pkcs1",
                      })
                      .toString("base64")
                  );
                  if (this.contactFromUuid(uuid) == undefined) {
                    pem.getPublicKey(message, (err, { publicKey }) => {
                      console.log(publicKey);
                      let contact = this.addContact({
                        uuid: uuid,
                        cert: message,
                        pub: crypto.createPublicKey(publicKey),
                      });
                      contact.sendIP();
                    });
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
    return this.contacts.find((contact) => {
      return contact.uuid == uuid;
    });
  }
  /**
   * get referral from its uuid
   * @param {string} uuid
   * @return {Object} Referral
   */
  referralFromUuid(uuid) {
    return this.referrals.find((referral) => {
      return referral.referent == uuid;
    });
  }
  /**
   * get contact from its IP
   * @param {string} IP
   * @returns {Contact} Contact
   */
  contactFromIp(ip) {
    return this.contacts.find((contact) => {
      return contact.remoteIP === ip;
    });
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
    this.cert = self.cert;
    this.pub = self.pub;
    this.uuid = self.uuid;
    this.try = 0;
    this.connected = false;
    this.rxBuffer = Buffer.alloc(0);
    this.ids = [];
    this.config = {
      maxBandwidth: {
        local: self.maxBandwidth || parent.maxBandwidth,
      },
      messageTypes: {
        local: self.messageTypes || parent.messageTypes,
      },
    };
  }
  _write(chunk) {
    this.send(chunk.toString("base64"), "message", false);
  }
  _read() {}
  /**
   * handles socket packets
   * @param {Buffer} data
   */
  handle_in(data) {
    this.rxBuffer = Buffer.concat([this.rxBuffer, data]);

    while (this.rxBuffer.length > 0) {
      let length = this.rxBuffer.slice(0, 2).readBigInt16BE();

      if (length + 4 > this.rxBuffer.length) break;

      let message = this.rxBuffer.slice(4, length + 5);
      let id = this.rxBuffer.slice(2, 3);
      let type = this.rxBuffer.slice(3, 4).readUInt8();

      this.parent.msgTypes[type].rx(
        message,
        id,
        this,
        this.parent.msgTypes[type].main
      );

      this.rxBuffer = this.rxBuffer.slice(length + 5);
    }
  }
  /**
   * send a message to this Contact
   * @param {any} message - the message to be sent
   * @param {Buffer} type - the type of the message as a UInt8/Buffer
   * @param {boolean} addEventListener - (optional) true on default
   * @param {Buffer} id - (optional) id of the message, used for responses
   * @returns {Promise} a Promise that resolves with the response
   */
  send(message, type, addEventListener = true, id) {
    return new Promise((resolve, reject) => {
      //console.log("write");
      let responded = false;
      if (!id) id = genID(this); // Add this
      this.ids.push(id);
      let length = message.length;
      this.socket.write(
        Buffer.concat([length, id, Buffer.allocunsafe(1).writeUInt8(type), message])
      );

      if (addEventListener)
        this.prependOnceListener("id-" + id, (data) => {
          responded = true;
          this.ids.splice(this.ids.indexOf(id), 1)
          resolve(data);
        });
      this.socket.on("error", (err) => {
        debugger;
        responded = true;
        this.connected = false;
        this.removeAllListeners("id-" + id);
        console.log("send from " + this.parent.uuid + err);
        this.connect().then(() => {
          this.send(message, type).then((res) => resolve(res));
        });
      });
      setTimeout(() => {
        if (!responded) {
          this.removeAllListeners("id-" + id);
          this.ids.splice(this.ids.indexOf(id), 1)
          resolve("timeout");
        }
      }, 60000);
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
        if (!this.parent.servers.find((server) => this.port == server.port)) {
          this.socket = tls.connect({
            port: this.remotePort,
            host: this.remoteIP,
            ca: [this.cert],
            checkServerIdentity: () => {
              return null;
            },
          });
          this.socket.setKeepAlive(true);
          this.socket.on("ready", () => {
            this.send("", "message");
            resolve();
          });
          this.socket.on("data", (data) => {
            this.parent.handle_in(this.socket, data);
          });
          this.socket.on("error", (err) => {
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
                this.connect().catch((err) => {
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
              this.connect(contact).catch((err) => {
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
    let id = Math.floor(Math.random() * 1000);
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
                    port: this.localPort,
                  })
                )
              ),
              id,
            },
            "IP"
          )
        );
    }
    Promise.allSettled(promises).then((results) => {
      results = results.filter((res) => res.status == "fulfilled");
      let responses = [...new Set(results.map((res) => res.value.body))];
      if (responses.length == 0) console.log("No responses to IP");
      let awnsers = [];
      for (let res of responses) {
        try {
          if (res && verify(this.pub, res)) {
            res.message = decrypt(this.parent.priv, res.message).toString();
            awnsers.push(res);
          }
        } catch (e) {
          console.log("Error: " + e);
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
    let id = Math.floor(Math.random() * 1000);
    for (let contact of this.parent.contacts) {
      if (contact.connected)
        contact.send(
          {
            referent: uuid,
            hops: 1,
            rm: rm,
            id,
          },
          "referral",
          false
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
    debugger;
    let port = this.localPort + 1;
    port--;
    if (!this.connected) {
      getPort().then((port) => console.log(port));
      if (this.parent.servers.find((server) => server.port == port))
        getPort().then((p) => (port = p));
      setTimeout(() => {
        console.log("punch on " + port);
        let socket = net.createConnection({
          host: data.ip,
          port: data.port,
          localPort: port,
          timeout: 100,
        });
        socket.on("data", (data) => {
          this.parent.handle_in(socket, data);
        });
        socket.on("ready", () => {
          console.log("client: " + this.parent.uuid);
          this.socket = socket;
          this.send("", "message");
        });
        socket.on("error", (err) => {
          console.log(err);
        });
        socket.on("close", (err) => {
          console.log("server: " + this.parent.uuid);

          if (!this.parent.servers.find((server) => server.port == port)) {
            let server = net.createServer((socket) => {
              socket.on("ready", () => {
                this.connected = true;
                this.socket = socket;
              });
              socket.on("data", (data) => {
                if (!this.parent.servers.find((server_) => server == server_))
                  this.parent.servers.push(server);

                this.parent.handle_in(socket, data);
              });
              socket.on("error", (err) => {
                this.connected = false;
                this.parent.servers.splice(
                  this.parent.servers.indexOf(
                    this.parent.servers.find((server_) => server == server_)
                  ),
                  1
                );
              });
            });
            server.listen(port);
            this.parent.servers.push({
              server: server,
              port: port,
            });
            server.on("error", (err) => {
              console.log(err);
            });
          } else console.log("already listening on port " + port);
        });
      }, timeout);
    } else console.log("already connected");
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
    cipher.on("data", (chunk) => (encrypted += chunk));
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

    decipher.on("data", (chunk) => (decrypted += chunk));
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
        oaepHash: "sha256",
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
      oaepHash: "sha256",
    },
    Buffer.from(message, "base64")
  );
  return message;
}
function genID(self, size = 1) {
  let done = false;
  let id;
  while (!done) {
    id = crypto.randomBytes(size)
    if (self.ids.indexOf(id) !== -1) done = true;
  }
  return id;
}