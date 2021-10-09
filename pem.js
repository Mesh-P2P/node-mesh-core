const pem = require("pem");

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
      console.log(keys1);
    })
);
