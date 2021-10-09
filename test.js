const mesh = require("./index.js");
const crypto = require("crypto");
const pem = require("pem");
const stdin = require("process").stdin;

pem.createCertificate(
  {
    days: 1,
    selfsigned: true
  },
  (err, keys) =>
    pem.getPublicKey(keys.certificate, (err, { publicKey }) => {
      var keys1 = {
        privateKey: keys.serviceKey,
        cert: keys.certificate,
        publicKey
      };
      pem.createCertificate(
        {
          days: 1,
          selfsigned: true
        },
        (err, keys) =>
          pem.getPublicKey(keys.certificate, (err, { publicKey }) => {
            var keys2 = {
              privateKey: keys.serviceKey,
              cert: keys.certificate,
              publicKey
            };
            pem.createCertificate(
              {
                days: 1,
                selfsigned: true
              },
              (err, keys) =>
                pem.getPublicKey(keys.certificate, (err, { publicKey }) => {
                  var keys3 = {
                    privateKey: keys.serviceKey,
                    cert: keys.certificate,
                    publicKey
                  };
                  pem.createCertificate(
                    {
                      days: 1,
                      selfsigned: true
                    },
                    (err, keys) =>
                      pem.getPublicKey(
                        keys.certificate,
                        (err, { publicKey }) => {
                          var keys4 = {
                            privateKey: keys.serviceKey,
                            cert: keys.certificate,
                            publicKey
                          };
                          if (err) throw err;

                          let sym_key = crypto.generateKeySync("aes", {
                            length: 256
                          });

                          console.log(keys1.cert);

                          instance = new mesh.Main(
                            {
                              uuid: 2,
                              cert: keys1.cert,
                              pub: keys1.publicKey,
                              priv: keys1.privateKey,
                              ip: "127.0.0.1",
                              port: 7575
                            },
                            [
                              {
                                uuid: 4,
                                cert: keys2.cert,
                                pub: keys2.publicKey,
                                remoteIP: "127.0.0.1",
                                remotePort: 7777
                              },
                              {
                                uuid: 7,
                                cert: keys3.cert,
                                pub: keys3.publicKey,
                                remoteIP: "127.0.0.1",
                                remotePort: 9041
                              }
                            ],
                            [],
                            (type, data) => {
                              return new Promise(resolve => {
                                switch (type) {
                                  case "contact_req":
                                    {
                                      sym_decrypt(sym_key, data).then(res =>
                                        resolve(res)
                                      );
                                    }
                                    break;
                                  case "contact_req_answers":
                                    {
                                      resolve(data[0]);
                                    }
                                    break;
                                }
                              });
                            },
                            true
                          );
                          instance2 = new mesh.Main(
                            {
                              uuid: 4,
                              cert: keys2.cert,
                              pub: keys2.publicKey,
                              priv: keys2.privateKey,
                              ip: "127.0.0.1",
                              port: 7777
                            },
                            [
                              {
                                uuid: 2,
                                cert: keys1.cert,
                                pub: keys1.publicKey,
                                remoteIP: "127.0.0.1",
                                remotePort: 7575
                              },
                              {
                                uuid: 7,
                                cert: keys3.cert,
                                pub: keys3.publicKey,
                                remoteIP: "127.0.0.1",
                                remotePort: 9041
                              }
                            ],
                            [],
                            (type, data) => {
                              return new Promise(resolve => {
                                switch (type) {
                                  case "contact_req":
                                    {
                                      sym_decrypt(sym_key, data).then(res =>
                                        resolve(res)
                                      );
                                    }
                                    break;
                                  case "contact_req_answers":
                                    {
                                      resolve(data[0]);
                                    }
                                    break;
                                }
                              });
                            }
                          );
                          instance2
                            .contactFromUuid(7)
                            .on("data", data => console.log(data.toString()));
                          setTimeout(() => {
                            instance3 = new mesh.Main(
                              {
                                uuid: 7,
                                cert: keys3.cert,
                                pub: keys3.publicKey,
                                priv: keys3.privateKey,
                                ip: "127.0.0.1",
                                port: 9041
                              },
                              [
                                {
                                  uuid: 2,
                                  cert: keys1.cert,
                                  pub: keys1.publicKey,
                                  remoteIP: "127.0.0.1",
                                  remotePort: 7575
                                },
                                {
                                  uuid: 4,
                                  cert: keys2.cert,
                                  pub: keys2.publicKey,
                                  remoteIP: "127.0.0.1",
                                  remotePort: 7777
                                },
                                {
                                  uuid: 34,
                                  cert: keys4.cert,
                                  pub: keys4.publicKey,
                                  remoteIP: "127.0.0.1",
                                  remotePort: 7675,
                                  secret: 8
                                }
                              ],
                              [],
                              (type, data) => {
                                return new Promise(resolve => {
                                  switch (type) {
                                    case "contact_req":
                                      {
                                        sym_decrypt(sym_key, data).then(res =>
                                          resolve({ body: res, key: sym_key })
                                        );
                                      }
                                      break;
                                    case "contact_req_answers":
                                      {
                                        resolve(data[0]);
                                      }
                                      break;
                                  }
                                });
                              }
                            );
                            setTimeout(() => {
                              console.log("connect to 34");
                              instance2.requestContact(34, sym_key);
                            }, 1000);
                          }, 100);
                          instance4 = new mesh.Main(
                            {
                              uuid: 34,
                              cert: keys4.cert,
                              pub: keys4.publicKey,
                              priv: keys4.privateKey,
                              ip: "127.0.0.1",
                              port: 7675
                            },
                            [
                              {
                                uuid: 7,
                                cert: keys3.cert,
                                pub: keys3.publicKey,
                                remoteIP: "127.0.0.1",
                                remotePort: 9041,
                                secret: 8
                              }
                            ],
                            [],
                            (type, data) => {
                              return new Promise(resolve => {
                                switch (type) {
                                  case "contact_req":
                                    {
                                      sym_decrypt(sym_key, data).then(res =>
                                        resolve({ body: res, key: sym_key })
                                      );
                                    }
                                    break;
                                  case "contact_req_answers":
                                    {
                                      resolve(data[0]);
                                    }
                                    break;
                                }
                              });
                            },
                            true
                          );
                        }
                      )
                  );
                })
            );
          })
      );
    })
);

function sym_decrypt(key, { iv, message }) {
  return new Promise((resolve, reject) => {
    iv = Uint8Array.from(Buffer.from(iv, "base64"));
    const decipher = crypto.createDecipheriv("AES256", key, iv);

    let decrypted = "";

    decipher.on("data", chunk => (decrypted += chunk));
    decipher.on("end", () => resolve(decrypted));

    decipher.write(message, "base64");
    decipher.end();
  });
}
