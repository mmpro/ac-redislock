const _ = require('lodash')
const async = require('async')
const { v4: uuidV4 } = require('uuid')

const redisLock = function() {
  /**
   * @param params.redis {Instance} REQUIRED Redis instance to use
   * @param params.logger {Instance} optional logger (e.g. Winston). Falls back to console
   * @param params.logLevel {String} optional logLevel
   */

  const init = function(params, cb) {
    this.redis = params.redis
    this.logger = _.get(params, 'logger', console)
    this.logLevel = _.get(params, 'logLevel', 'log')

    // make a test connection
    const testKey = uuidV4()
    this.redis.set(testKey, 1, 'EX', 1, (err) => {
      if (err) this.logger['error']({ message: 'cannotConnectToRedis' })
      if (_.isFunction(cb)) return cb(err)
    })
  }

  /**
   * @param params.redisKey {String} REQUIRED identifier
   * @param params.expires {Integer} optional seconds to expire the key automatically
   * @param cb (err or null) err can be 423 (redis key is locked) or a real error or null
   */
  const lockKey = function(params, cb) {
    if (!this.redis) return cb({ message: 'lockKey_redisNotAvailable', initiator: 'ac-redisLock' })

    const redisKey = params.redisKey
    if (!redisKey) return cb({ message: 'lockKey_redisKey_isRequired', initiator: 'ac-redisLock' })
    const expires = (params.expires && parseInt(params.expires)) || 10 // 10 seconds default value
    const value = params.value || uuidV4()

    this.redis.set(redisKey, value, 'EX', expires, 'NX', (err, result) => {
      this.logger[this.logLevel]('ac-redisLock: REDIS LOCK status for key %s expires %s status %s', redisKey, expires, (result || 423))
      if (err) {
        if (_.get(err, 'message') === 'Connection is closed.') {
          return cb({ status: 503, message: 'redisDown' }) // return 503 to signal a problem with Redis
        }
        return cb(err)
      }
      if (result === 'OK') return cb(null, value)
      return cb(423) // the key is already locked
    })
  }

  const releaseLock = function(params, cb) {
    if (!this.redis) return cb({ message: 'releaseLock_redisNotAvailable', initiator: 'ac-redisLock' })

    const redisKey = params.redisKey
    if (!redisKey) return cb({ message: 'releaseLock_redisKey_isRequired', initiator: 'ac-redisLock' })
    const value = params.value

    async.series({
      checkValue: (done) => {
        if (!value) return done()
        this.redis.get(redisKey, (err, result) => {
          if (err) return done(err)
          if (result !== value) return done({ message: 'releaseLock_valueMismatch', additionalInfo: { redisKey, expected: result, value } })
          return done()
        })
      },
      deleteKey: (done) => {
        this.redis.del(redisKey, (err) => {
          if (err) {
            if (_.get(err, 'message') === 'Connection is closed.') {
              return done({ status: 503, message: 'redisDown' }) // return 503 to signal a problem with Redis
            }
            return done(err)
          }
          return done()
        })
      }
    }, err => {
      if (_.isFunction(cb)) return cb(err)
      if (err) this.logger['error']('ac-redisLock | ReleaseLock | Failed | %j', err)
    })
  }

  return {
    init,
    lockKey,
    releaseLock
  }
}

module.exports = redisLock()
