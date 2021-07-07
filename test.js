const mesh = require("./index.js");
const crypto = require("crypto");
const stdin = require("process").stdin;

let keys1 = crypto.generateKeyPairSync("rsa", {
  modulusLength: 2048
});
let keys2 = crypto.generateKeyPairSync("rsa", {
  modulusLength: 2048
});
let keys3 = crypto.generateKeyPairSync("rsa", {
  modulusLength: 2048
});
let keys4 = crypto.generateKeyPairSync("rsa", {
  modulusLength: 2048
});
let sym_key = crypto.generateKeySync("aes", { length: 256 });

instance = new mesh.Main(
  {
    uuid: 2,
    pub: keys1.publicKey,
    priv: keys1.privateKey,
    ip: "127.0.0.1",
    port: 7575
  },
  [
    {
      uuid: 4,
      pub: keys2.publicKey,
      remoteIP: "127.0.0.1",
      remotePort: 7777
    },
    {
      uuid: 7,
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
            sym_decrypt(sym_key, data).then(res => resolve(res));
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
    pub: keys2.publicKey,
    priv: keys2.privateKey,
    ip: "127.0.0.1",
    port: 7777
  },
  [
    {
      uuid: 2,
      pub: keys1.publicKey,
      remoteIP: "127.0.0.1",
      remotePort: 7575
    },
    {
      uuid: 7,
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
            sym_decrypt(sym_key, data).then(res => resolve(res));
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
instance2.contactFromUuid(7).on("data", data => console.log(data.toString()));
setTimeout(() => {
  instance3 = new mesh.Main(
    {
      uuid: 7,
      pub: keys3.publicKey,
      priv: keys3.privateKey,
      ip: "127.0.0.1",
      port: 9041
    },
    [
      {
        uuid: 2,
        pub: keys1.publicKey,
        remoteIP: "127.0.0.1",
        remotePort: 7575
      },
      {
        uuid: 4,
        pub: keys2.publicKey,
        remoteIP: "127.0.0.1",
        remotePort: 7777
      },
      {
        uuid: 34,
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
    pub: keys4.publicKey,
    priv: keys4.privateKey,
    ip: "127.0.0.1",
    port: 7675
  },
  [
    {
      uuid: 7,
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
