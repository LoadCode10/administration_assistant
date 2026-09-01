import client from './client'

export function register(payload) {
  return client.post('/auth/register', payload).then((r) => r.data)
}

export function login(payload) {
  return client.post('/auth/login', payload).then((r) => r.data)
}

export function me() {
  return client.get('/auth/me').then((r) => r.data)
}

export function logout() {
  return client.post('/auth/logout')
}
