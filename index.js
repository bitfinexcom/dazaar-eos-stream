const from = require('from2')
const { EventEmitter } = require('events')

const { Api, JsonRpc } = require('eosjs')
const { JsSignatureProvider } = require('eosjs/dist/eosjs-jssig') // development only
const fetch = require('node-fetch') // node only; not needed in browsers
const { TextEncoder, TextDecoder } = require('util') // node only; native TextEncoder/Decoder

module.exports = configure

function configure (opts) {
  if (!opts) opts = {}
  const chainId = opts.chainId || '5fff1dae8dc8e2fc4d5b23b2c7665c97f9e9d8edf2b6485a86ba311c25639191'
  const rpc = new JsonRpc(opts.rpc || 'https://api-kylin.eoslaomao.com', { fetch })

  let api = null
  const account = opts.account
  if (!account) throw new Error('opts.account must be set')

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

    api.transact({
      actions: [{
        account: 'eosio.token',
        name: 'transfer',
        authorization: [{
          actor: account,
          permission: 'owner'
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

  function subscription (filter, rate) {
    const match = rate.trim().match(/^(\d(?:\.\d+)?)\s*EOS\s*\/\s*s$/i)
    if (!match) throw new Error('rate should have the form "n....nn EOS/s"')

    const perSecond = Number(match[1])
    const sub = new EventEmitter()

    const stream = createTransactionStream()
    const activePayments = []

    stream.on('data', function (data) {
      if (data.act.data.memo !== filter) return
      if (data.act.data.to !== account) return

      const amount = parseQuantity(data.act.data.quantity)
      const time = new Date(data.block_time + 'Z').getTime() // The EOS timestamps don't have the ISO Z at the end?

      activePayments.push({ amount, time })
      sub.emit('update')
    })

    sub.active = function (minSeconds) {
      if (!minSeconds) minSeconds = 0

      let overflow = 0
      const now = Date.now() + (minSeconds * 1000)

      for (let i = 0; i < activePayments.length; i++) {
        const { amount, time } = activePayments[i]
        const nextTime = i + 1 < activePayments.length ? activePayments[i + 1].time : now

        const consumed = Math.max(0, perSecond * ((nextTime - time) / 1000))
        const currentAmount = overflow + amount

        overflow = currentAmount - consumed
        console.log(overflow, activePayments, i)
        if (overflow < 0) { // we spent all the moneys
          activePayments.splice(i, 1) // i is always 0 here i think, but better safe than sorry
          i--
          overflow = 0
        }
      }

      return overflow > 0
    }

    sub.destroy = function () {
      stream.destroy()
    }

    return sub
  }

  function createTransactionStream () {
    let prevBlock = -1
    let callback
    let pos = 0
    let timeout

    const stream = from.obj(read)
    stream.on('close', () => clearTimeout(timeout))
    return stream

    function read (size, cb) {
      callback = cb
      rpc.history_get_actions(account, pos, 1).then(onactions).catch(destroy)
    }

    function onactions (acs) {
      const res = []

      for (const a of acs.actions) {
        pos++

        if (a.block_num === prevBlock) continue
        prevBlock = a.block_num

        const act = a.action_trace
        if (act) res.push(act)
      }

      if (!res.length) {
        if (acs.actions.length) return read(0, callback)
        return setTimeout(read, 5000, 0, callback)
      }

      for (let i = 0; i < res.length - 1; i++) stream.push(res[i])
      callback(null, res[res.length - 1])
    }

    function destroy (err) {
      stream.destroy(err)
    }
  }
}

function parseQuantity (s) {
  const m = s.match(/^(\d+(?:\.\d+)?) EOS$/)
  if (!m) return 0
  return Number(m[1])
}
