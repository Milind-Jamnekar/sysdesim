export const TICK_DURATION = 0.1 // seconds (10 ticks/s, setInterval at 100ms)
export const BASE_LOAD = 1000 // req/s baseline incoming to LB

export const CACHE_HIT_RATE_HEALTHY = 0.90
export const CACHE_HIT_RATE_FAILED = 0.00

export const CAPACITY: Record<string, number> = {
  lb: 5000,
  appA: 2000,
  appB: 2000,
  cache: 3000,
  db: 400,
}

export const BASE_LAT: Record<string, number> = {
  lb: 1,
  appA: 5,
  appB: 5,
  cache: 2,
  db: 20,
}
