# dazaar-eos-stream

Dazaar subscriber implementation for EOS.

## Usage

```js
const deos = require('dazaar-eos-stream')

const { subscription } = deos({
  rpc: ..., // set rpc endpoint (must have the history plugin)
  chainId: ..., // set the chain id
  privateKey: ..., // eos private key (only needed if you wanna pay for a subscription)
  account: ... // set your eos account here
})

// watch for incoming transactions to your account with the below memo.
// the subscription should match for a spend rate at 0.001 EOS/s
const sub = subscription('dazaar key hash: deadbeef', '0.001 EOS/s')

sub.on('update', function () {
  // new transaction found on the chain matching the memo filter above
})

// At the current time, is there money left on the subscription based on the
// spend rate specified?
console.log(sub.active())
```

Currently the rpc and chainId defaults to the CryptoKylin EOS testnet.
Once this module is fully stable it will default to the main net.

## API

#### `d = deos(options)`

Make a new instance. Options include:

```js
{
  rpc: chainRpcEndpoint, // must have the history plugin enabled
  chainId: ..., // the chain id
  account: ..., // your account id
  privateKey: ... // needed for payments
}
```

#### `d.pay(destinationAccount, amount, memo, [callback])`

Pay for a subscription. `amount` should be a string specifying
how much you want to pay (ie `0.1234 EOS` fx) and memo should
be the Dazaar filter specifying the hash of your Dazaar Noise public key.

#### `sub = d.subscription(dazaarFilter, spendRate)`

Create a subscription monitor. Dazaar filter should be the filter you are watching
and spend rate should be how many EOS you want the buyer to pay (ie `0.0001 EOS/s` fx).

#### `bool = sub.active([minSeconds])`

Tells you if the filter has any money left based on the spend rate.
Set `minSeconds` to the minimum amount of seconds they should have money left for (defaults to 0).

#### `sub.on('update')`

Emitted everytime a new transaction is discovered on the chain.
