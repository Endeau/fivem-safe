-- Token bucket per player: `calls` calls, refilled evenly over `per` seconds.
-- `now` returns milliseconds (GetGameTimer on the server).

local ratelimit = {}
ratelimit.__index = ratelimit

function ratelimit.new(calls, per, now)
  if type(calls) ~= 'number' or calls < 1 or math.floor(calls) ~= calls then
    error('safe_events: rate.calls must be a positive integer', 0)
  end
  if type(per) ~= 'number' or per <= 0 then
    error('safe_events: rate.per must be a positive number of seconds', 0)
  end
  return setmetatable({
    capacity = calls,
    refillPerMs = calls / (per * 1000),
    now = now,
    buckets = {},
  }, ratelimit)
end

--- Spends one call for `key`. Returns false when the bucket is empty.
function ratelimit:take(key)
  local t = self.now()
  local bucket = self.buckets[key]
  if not bucket then
    bucket = { tokens = self.capacity, at = t }
    self.buckets[key] = bucket
  else
    bucket.tokens = math.min(self.capacity, bucket.tokens + (t - bucket.at) * self.refillPerMs)
    bucket.at = t
  end
  if bucket.tokens < 1 then return false end
  bucket.tokens = bucket.tokens - 1
  return true
end

function ratelimit:forget(key)
  self.buckets[key] = nil
end

return ratelimit
