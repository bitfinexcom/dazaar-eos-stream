const from = require('from2')
const clerk = require('payment-tracker')
const { EventEmitter } = require('events')

const { Api, JsonRpc } = require('eosjs')
const { JsSignatureProvider } = require('eosjs/dist/eosjs-jssig') // development only
const fetch = require('node-fetch') // node only; not needed in browsers
const { TextEncoder, TextDecoder } = require('util') // node only; native TextEncoder/Decoder

module.exports = configure
module.exports.testnet = function (opts) {
  if (!opts) opts = {}
  return configure({ ...opts, chainId: '5fff1dae8dc8e2fc4d5b23b2c7665c97f9e9d8edf2b6485a86ba311c25639191', rpc: 'https://api-kylin.eoslaomao.com' })
}

function configure (opts) {
  if (!opts) opts = {}
  const chainId = opts.chainId || 'aca376f206b8fc25a6ed44dbdc66547c36c6c33e3a119ffbeaef943642f0e906'
  const rpc = new JsonRpc(opts.rpc || 'https://api.eosnewyork.io', { fetch })
  const irreversible = !!opts.irreversible

  let api = null
  const account = opts.account
  if (!account) throw new Error('opts.account must be set')
  const contract = opts.contract || 'eosio.token'
  const permission = opts.permission || 'active'

  if (opts.privateKey) {
    const signatureProvider = new JsSignatureProvider([ opts.privateKey ])

    api = new Api({
      rpc,
      signatureProvider,
      textDecoder: new TextDecoder(),
      textEncoder: new TextEncoder(),
      chainId
    })
  }

  return {
    pay,
    subscription,
    createTransactionStream
  }

  function pay (destination, amount, memo, cb) {
    if (!api) throw new Error('opts.privateKey must be provided in the constructor')
    if (typeof (amount) === 'number') amount = amount.toFixed(4) + ' EOS'

    api.transact({
      actions: [{
        account: contract,
        name: 'transfer',
        authorization: [{
          actor: account,
          permission
        }],
        data: {
          from: account,
          to: destination,
          quantity: amount,
          memo: memo
        }
      }]
    }, {
      blocksBehind: 3,
      expireSeconds: 30
    }).then(() => process.nextTick(cb, null)).catch((err) => process.nextTick(cb, err))
  }

  // include 2000ms payment delay to account for block latency
  function subscription (filter, paymentInfo, minSeconds, paymentDelay) {
    const self = this
    let perSecond = 0

    if (typeof paymentInfo === 'object' && paymentInfo) { // dazaar card
      perSecond = convertDazaarPayment(paymentInfo)
      minSeconds = paymentInfo.minSeconds
      paymentDelay = paymentInfo.paymentDelay
    } else {
      const match = paymentInfo.trim().match(/^(\d(?:\.\d+)?)\s*EOS\s*\/\s*s$/i)
      if (!match) throw new Error('rate should have the form "n....nn EOS/s"')
      perSecond = Number(match[1])
    }

    const sub = new EventEmitter()

    const stream = createTransactionStream()
    let payments = clerk(perSecond, minSeconds, paymentDelay)

    sub.synced = false
    stream.once('synced', function () {
      sub.synced = true
      sub.emit('synced')
    })

    stream.on('data', function (data) {
      if (data.act.data.memo !== filter) return
      if (data.act.data.to !== account) return

      const amount = parseQuantity(data.act.data.quantity)
      const time = new Date(data.block_time + 'Z').getTime() // The EOS timestamps don't have the ISO Z at the end?

      payments.add({ amount, time })
      sub.emit('update')
    })

    sub.active = payments.active
    sub.remainingTime = payments.remainingTime
    sub.remainingFunds = payments.remainingFunds

    sub.destroy = function () {
      payments = null
      stream.destroy()
    }

    return sub
  }

  function createTransactionStream () {
    let prevBlock = -1
    let callback
    let pos = 0
    let timeout
    let lastIrreversibleBlock = 0
    let synced = false

    const stream = from.obj(read)
    stream.on('close', () => clearTimeout(timeout))

    return stream

    function read (size, cb) {
      callback = cb
      rpc.history_get_actions(account, pos, 30).then(onactions).catch(destroy)
    }

    function onactions (acs) {
      const res = []
      let prev = pos

      lastIrreversibleBlock = acs.last_irreversible_block

      for (const a of acs.actions) {
        if (a.block_num >= lastIrreversibleBlock && irreversible) break
        pos++
        if (a.block_num === prevBlock) continue
        prevBlock = a.block_num

        const act = a.action_trace
        if (act && isTransaction(act)) res.push(act)
      }

      if (!res.length) {
        if (acs.actions.length && prev !== pos) return read(0, callback)
        if (!synced) {
          synced = true
          stream.emit('synced')
        }
        return setTimeout(read, 5000, 0, callback)
      }

      for (let i = 0; i < res.length - 1; i++) stream.push(res[i])
      callback(null, res[res.length - 1])
    }

    function isTransaction (trace) {
      if (trace.act.name !== 'transfer') return false
      if (trace.act.account !== contract) return false
      return true
    }

    function destroy (err) {
      stream.destroy(err)
    }
  }
}

function convertDazaarPayment (pay) {
  let ratio = 0

  switch (pay.unit) {
    case 'minutes':
      ratio = 60
      break
    case 'seconds':
      ratio = 1
      break
    case 'hours':
      ratio = 3600
      break
  }

  const perSecond = Number(pay.amount) / (Number(pay.interval) * ratio)
  if (!perSecond) throw new Error('Invalid payment info')

  return perSecond
}

function parseQuantity (s) {
  const m = s.match(/^(\d+(?:\.\d+)?) EOS$/)
  if (!m) return 0
  return Number(m[1])
}
