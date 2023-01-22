function PublicKey(point) {
  this.point = point.affine();
}

PublicKey.prototype.toString = function() {
  let is_odd = this.point.y.value % BigInt(2) == 1;
  let hex = this.point.x.value.toString(16);
  let addr = 'z' + (is_odd ? '3' : '2') + '0'.repeat(64 - hex.length) + hex;
  return addr;
}

PublicKey.fromString = function(s) {
  if(s.length != 66 || s[0] != "z" || (s[1] != "2" && s[1] != "3")) {
    throw Error("Invalid mpn address!");
  }
  let is_odd = s[1] == "3";
  let x = new Field('0x' + s.slice(2));
  var y = (new Field(1)).sub(D.mul(x.mul(x))).invert().mul((new Field(1).sub(A.mul(x).mul(x))));
  y = y.sqrt();
  let y_is_odd = y.value % BigInt(2) == 1;
  if(y_is_odd != is_odd) {
      y = y.neg();
  }
  return new PublicKey(new Point(x, y));
}

function sha3(inp) {
  let output = sha3_256(inp);
  let rev_output = output.match(/[a-fA-F0-9]{2}/g).reverse().join('');
  return new Field(BigInt('0x' + rev_output));
}

function Signature(r, s) {
  this.r = r;
  this.s = s;
}

function PrivateKey(seed) {
  this.randomness = sha3(seed);
  this.scalar = sha3(this.randomness.bytes());
  this.pub_key = new PublicKey(BASE.mul(this.scalar));
}

PrivateKey.prototype.sign = function(msg) {
  // r=H(b,M)
  let r = poseidon2(this.randomness, msg);

  // R=rB
  let rr = BASE.mul(r).affine();

  // h=H(R,A,M)
  let h = poseidon5(rr.x, rr.y, this.pub_key.point.x, this.pub_key.point.y, msg);

  // s = (r + ha) mod ORDER
  let ha = h.value * this.scalar.value;
  let s = new Field((r.value + ha) % ORDER);

  return new Signature(rr, s);
}

PublicKey.prototype.mpn_account_index = function() {
  return Number(this.point.x.value & BigInt(0x3fffffff));
}

PublicKey.prototype.verify = function(msg, sig) {
  if(!this.point.isOnCurve() || !sig.r.isOnCurve()) {
    return false;
  }

  // h=H(R,A,M)
  let h = poseidon5(sig.r.x, sig.r.y, this.point.x, this.point.y, msg);

  let sb = BASE.mul(sig.s);

  let r_plus_ha = this.point.mul(h).add(sig.r);

  return r_plus_ha.equals(sb);
}

PrivateKey.prototype.create_tx = function(nonce, to, amount, fee) {
  let tx_hash = poseidon7(
    new Field(nonce),
    to.point.x,
    to.point.y,
    new Field(1),
    new Field(amount),
    new Field(1),
    new Field(fee)
  );
  alert(tx_hash.value.toString(16));
  let sig = this.sign(tx_hash);
  return {
    "s":sig.s.montgomery().value.toString(16),
    "rx":sig.r.x.montgomery().value.toString(16),
    "ry":sig.r.y.montgomery().value.toString(16),
    "rz":sig.r.z.montgomery().value.toString(16),
  }
  return {
    "nonce": nonce,
    "src_pub_key": this.pub_key.toString(),
    "dst_pub_key": to.toString(),
    "src_token_index": 0,
    "src_fee_token_index": 0,
    "dst_token_index": 0,
    "amount_token_id" :"Ziesha",
    "fee_token_id" :"Ziesha",
    "amount": amount,
    "fee": fee,
    "sig": ""
  };
}

var STATE = {sk: null, account: null};
let NODE = "65.108.193.133:8765";
let NETWORK = 'chay-4';

async function getAccount(pub_key) {
  return fetch('http://' + NODE + '/mpn/account?index=' + pub_key.mpn_account_index(), {
      method: 'GET',
      headers: {
          'X-ZIESHA-NETWORK-NAME': NETWORK,
          'Accept': 'application/json'
      },
  })
  .then(response => response.json());
}

async function sendTx(tx) {
  alert(JSON.stringify({tx: tx}))
  return fetch('http://' + NODE + '/transact/zero', {
      method: 'POST',
      headers: {
          'X-ZIESHA-NETWORK-NAME': NETWORK,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
      },
      body: JSON.stringify({tx: tx})
  })
  .then(response => response.json());
}

function render() {
  if(STATE.sk === null) {
    document.getElementById("content").innerHTML = `
      <form onsubmit="login(event)">
        <div><label>Mnemonic: </label><input id="mnemonic" type="text" name="mnemonic"/></div>
        <div><button>Login!</button></div>
      </form>
      `;
  }
  else {
    let html = "";
    if(STATE.account !== null) {
      html += '<p><b>Address:</b> ' + STATE.sk.pub_key + "</p>";
      html += '<p><b>Nonce:</b> ' + STATE.account.nonce + "</p>";
      if(STATE.account.tokens.length > 0 && STATE.account.tokens[0].token_id == "Ziesha") {
        html += '<p><b>Balance:</b> ' + STATE.account.tokens[0].amount / 1000000000 + "ℤ</p>";
      }
    }
    html += `
    <form onsubmit="send(event)">
      <div><label>Nonce: </label><input type="number" name="nonce"/></div>
      <div><label>To: </label><input type="text" name="to"/></div>
      <div><label>Amount: </label><input type="number" name="amount"/></div>
      <div><label>Fee: </label><input type="number" name="fee"/></div>
      <div><button>Send!</button></div>
    </form>
      `;
      document.getElementById("content").innerHTML = html;
  }
}

async function login(event) {
  event.preventDefault();
  let mnemonic = document.getElementById("mnemonic").value;
  STATE.sk = new PrivateKey(toSeed(mnemonic));
  STATE.account = (await getAccount(STATE.sk.pub_key)).account;
  render();
}

async function logout(event) {
  event.preventDefault();
  STATE.sk = null;
  render();
}

async function send(event) {
  event.preventDefault();
  let tx = STATE.sk.create_tx(0, PublicKey.fromString("z2314e428356bdc7cf43f02c42d1f8ce0bd10a6cd692d93d61fb040044d7a4d242"), 1000000000, 0);
  await sendTx(tx);
  alert(tx);
}

render();
