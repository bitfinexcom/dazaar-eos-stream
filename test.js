const test = require('tape')
const deos = require('./')

var buyerOpts = {
  privateKey: '5KQwrPbwdL6PhXujxW37FSSQZ1JiwsST4cqQzDeyXtP79zkvFD3',
  account: 'bob',
  rpc: 'http://localhost:8888',
  chainId: 'cf057bbfb72640471fd910bcb67639c22df9f92470936cddc1ade0e2f2e7dc4f'
}

var sellerOpts = {
  account: 'alice',
  privateKey: '5KDiuujiPNpTEZ1zJ3NNCHDMq8C3SeAmHMbhxv5MGkphTYAHy7s',
  chainId: 'cf057bbfb72640471fd910bcb67639c22df9f92470936cddc1ade0e2f2e7dc4f',
  rpc: 'http://localhost:8888'
}

var buyer
var seller

test('configure', t => {
  buyer = deos(buyerOpts)
  seller = deos(sellerOpts)

  t.assert(buyer.pay && seller.pay)
  t.assert(buyer.subscription && seller.subscription)
  t.assert(buyer.createTransactionStream && seller.createTransactionStream)

  t.end()
})

test('configure testnet', t => {
  var testnet = deos.testnet({ account: 'test', privateKey: '5KDiuujiPNpTEZ1zJ3NNCHDMq8C3SeAmHMbhxv5MGkphTYAHy7s' })

  t.assert(testnet.pay)
  t.assert(testnet.subscription)
  t.assert(testnet.createTransactionStream)

  t.end()
})

test('create transaction stream & pay', t => {
  var str = seller.createTransactionStream()
  var label = 'pay ' + Math.random().toString(10)
  var synced = false

  str.on('synced', function () {
    synced = true
    buyer.pay(sellerOpts.account, '0.1000 EOS', label, (err) => {
      if (err) console.log(err)
    })
  })

  str.on('data', function (data) {
    if (!synced) return
    t.equal(label, data.act.data.memo)
    str.destroy()
    t.end()
  })
})

test('subscription & pay', t => {
  var amount = 20
  var rate = 0.05

  // random label prevents update events from historic transactions
  var label = 'sub ' + Math.random().toFixed(10)

  const sub = seller.subscription(label, `${rate.toFixed(4)} EOS/s`)

  sub.on('update', function (data) {
    t.ok(sub.active())

    var times = []
    var funds = []

    // check time/funds are depleting correctly
    repeat(50, 200, function () {
      var dTime = delta(times)
      var dFunds = delta(funds)

      t.assert(avg(dTime) - 200 < 5)
      // funds deplete to within 1% of expected rate
      t.assert(Math.abs(avg(dFunds) - rate / 5) < 0.01 * rate)

      sub.destroy()
      t.end()
    })

    function repeat (n, t, cb) {
      if (!sub.active() || n === 0) return cb() 

      times.push(sub.remainingTime())
      funds.push(sub.remainingFunds())

      return setTimeout(repeat, t, --n, t, cb)
    }
  })

  sub.on('synced', () => {
    buyer.pay(sellerOpts.account, `${amount}.0000 EOS`, label, (err) => {
      if (err) console.log(err)
    })
  })
})

test('subscription: sync', t => {
  var amount = 0.01

  // random label prevents update events from historic transactions
  var label = 'sync ' + Math.random().toFixed(10)

  buyer.pay(sellerOpts.account, `${amount.toFixed(4)} EOS`, label, function (err) {
    if (err) console.error(err.json.error)

    var sub = seller.subscription(label, `0.0001 EOS/s`)
    
    // before sync complete
    t.notOk(sub.active())

    // wait for sync
    sub.on('synced', () => {
      t.ok(sub.active())
      t.assert(sub.remainingTime() > 0)
      t.assert(amount - sub.remainingFunds() < 110)

      sub.destroy()
      t.end()
    })
  })
})

test('subscription: long sync', t => {
  var amount = 0.01

  // random label prevents update events from historic transactions
  var label = 'long ' + Math.random().toFixed(10)

  buyer.pay(sellerOpts.account, `${amount.toFixed(4)} EOS`, label, function (err) {
    if (err) console.error(err)

    repeat(500, function () { 
      var sub = seller.subscription(label, `0.0001 EOS/s`)
      
      // before sync complete
      t.notOk(sub.active())

      // wait for sync
      sub.once('synced', () => {
        t.ok(sub.active())
        t.assert(sub.remainingTime() > 0)
        t.assert(sub.remainingFunds() > 0)

        sub.destroy()
        t.end()
      })
    })

    function repeat (n, cb) {
      if (n === 0) return cb()

      buyer.pay(sellerOpts.account, `0.0001 EOS`, `ignore this${n}`, (err) => {
        if (err) return console.error(err)
        return setImmediate(repeat, --n, cb)
      })
    }
  })
})

test('subscription runs out', t => {
  var amount = 0.02

  // random label prevents update events from historic transactions
  var label = 'run out ' + Math.random().toFixed(10)
  var synced = false

  var rate = amount / 2
  var sub = seller.subscription(label, `${rate} EOS/s`, 0, 5000)

  sub.once('synced', function () {
    synced = true
    t.notOk(sub.active(), 'sync')
    
    buyer.pay(sellerOpts.account, `${amount.toFixed(4)} EOS`, label, function (err) {
      if (err) console.error(err)
    })
  })

  sub.on('update', function () {
    if (!synced) return
    t.ok(sub.active(), 'update')

    setTimeout(() => {
      t.notOk(sub.active(), 'timeout')
      
      sub.destroy()
      t.end()
    }, 3000)
  })
})

function delta (arr) {
  return arr.slice(0, arr.length - 1).map((val, i) => val - arr[i + 1])
}

function avg (arr) {
  var sum = arr.reduce((acc, val) => acc + val, 0)
  return sum / arr.length
}
