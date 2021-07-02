const mesh = require("./index.js");
const crypto = require("crypto");
const { subtle, getRandomValues } = require("crypto").webcrypto;

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
    switch (type) {
      case "contact_req":
        {
          return 10;
        }
        break;
      case "contact_req_answers":
        {
          return data[0];
        }
        break;
    }
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
    switch (type) {
      case "contact_req":
        {
          return 10;
        }
        break;
      case "contact_req_answers":
        {
          return data[0];
        }
        break;
    }
  }
);
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
      }
      /*{
        uuid: 34,
        pub: keys4.publicKey,
        remoteIP: "127.0.0.1",
        remotePort: 7675,
        secret: 8
      }*/
    ],
    [],
    (type, data) => {
      switch (type) {
        case "contact_req":
          {
            return 10;
          }
          break;
        case "contact_req_answers":
          {
            return data[0];
          }
          break;
      }
    }
  );
}, 100);
/*instance4 = new mesh.Main(
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
    switch (type) {
      case "contact_req":
        {
          return 10;
        }
        break;
      case "contact_req_answers":
        {
          return data[0];
        }
        break;
    }
  },
  true
);*/
