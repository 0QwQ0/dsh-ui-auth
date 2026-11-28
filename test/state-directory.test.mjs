import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtemp, readFile, writeFile, unlink, access, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { apply } from '../lib/index.js'

const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-auth-data-test-'))
const original = process.env.DSH_AUTH_DATA_DIR
const savedLog = console.log
console.log = () => {} // bootstrap credentials are test-only and should not enter output
const pause = () => new Promise(resolve => setTimeout(resolve, 20))
async function until(check, label) {
 const deadline=Date.now()+10000
 while(Date.now()<deadline) { if(await check()) return; await pause() }
 throw new Error('Timed out: '+label)
}
async function scenario(dir, label, invalid = false) {
  if (dir === undefined) delete process.env.DSH_AUTH_DATA_DIR
  else process.env.DSH_AUTH_DATA_DIR = dir
  const files = new Map(), resolutions = []
  const server = new EventEmitter()
  server.on('request', () => {})
  const records = new Map()
  const fs = {
    async resolve(p) { resolutions.push(p); return p },
    async readText(p) { if (dir) return readFile(p, 'utf8'); if (!files.has(p)) throw new Error('not found'); return files.get(p) },
    async writeText(p, v) { if (dir) await writeFile(p, v); else files.set(p, v) },
    async unlink(p) { if (dir) await unlink(p); else files.delete(p) },
  }
  const credentials = {
    async listRecords() { return [...records].map(([key, v]) => ({key, kind:v.kind})) },
    async readRecord(key) { return records.get(key) },
    async modifyRecord(key, fn) { const next = await fn(records.get(key)); if (next !== undefined) records.set(key, next); return records.get(key) },
    async deleteRecord(key) { records.delete(key) },
  }
  const connection = { authorizeIndex(req, res) { res.writeHead(200, {'set-cookie':'native=test'}); return true }, requestRejection() {}, authenticatedUrl(x) {return x}, createSharedFetchHandler() {return {fetch: async () => new Response('{}')}} }
  apply({get(n) {return {fs, credentials, connection, webServer:{server}}[n]}, effect() {}, interval() {return () => {}}})
  await pause()
  const file = n => dir ? path.join(path.resolve(dir), n) : n
  const boot = file('dsh-ui-auth-bootstrap.txt')
  if (invalid) {
    const req = new EventEmitter(); req.method='GET'; req.url='/'; req.headers={host:'localhost:49211'}; req.socket={remoteAddress:'127.0.0.1'}
    const res={status:0,writeHead(status){this.status=status},end(){},setHeader(){}}
    await until(async()=>{server.emit('request',req,res);return res.status===503},'fail closed')
    assert.equal(res.status,503,'unusable configured directory fails closed')
    assert.ok(!resolutions.some(p => !path.isAbsolute(p)),'no fallback to cwd')
    return
  }
  await until(async()=>{try { await fs.readText(boot);return true }catch{return false}},label+' bootstrap')
  const password = /密码:\s+(\S+)/.exec(await fs.readText(boot))[1]
  async function post(url, body, cookie) {
    const req = new EventEmitter(); req.method='POST'; req.url=url; req.headers={host:'localhost:49211','content-type':'application/json', ...(cookie ? {cookie}: {})}; req.socket={remoteAddress:'127.0.0.1'}
    const text=JSON.stringify(body); req[Symbol.asyncIterator]=async function*(){yield Buffer.from(text)}
    const res={headers:{}, status:0, writeHead(status,headers){this.status=status;Object.assign(this.headers,headers)},setHeader(k,v){this.headers[k]=v},end(v){this.body=v;this.ended=true},write(){return true}}
    server.emit('request',req,res); process.nextTick(()=>{req.emit('data',Buffer.from(text));req.emit('end')}); await until(()=>res.ended,label+' '+url); return res
  }
  const login=await post('/auth/login',{username:'admin',password}); assert.equal(login.status,200,label+' login')
  const cookie=String(login.headers['set-cookie']).split(';')[0]
  await until(async()=>{try {await fs.readText(file('dsh-ui-auth-sessions.json'));return true}catch{return false}},label+' sessions')
  const change=await post('/auth/rpc/changePassword',{oldPassword:password,newPassword:'DataDir-Test-123!'},cookie)
  assert.equal(change.status,200,label+' password change'); await pause()
  await until(async()=>{try {await fs.readText(boot);return false}catch{return true}},label+' bootstrap deletion')
  await until(async()=>{try {await fs.readText(file('dsh-ui-auth-audit.jsonl'));return true}catch{return false}},label+' audit')
  assert.ok(resolutions.every(p => dir ? path.isAbsolute(p) && p.startsWith(path.resolve(dir)+path.sep) : !path.isAbsolute(p)), label+' consistent paths')
}
try {
 await scenario(undefined,'legacy cwd')
 const a=path.join(root,'a'),b=path.join(root,'b')
 await scenario(a,'custom A'); await scenario(b,'custom B')
 const blocked=path.join(root,'not-a-directory'); await writeFile(blocked,'test')
 await scenario(path.join(blocked,'child'),'unusable directory',true)
 await writeFile(path.join(a,'dsh-ui-auth-sessions.json'),'instance-A-marker')
 assert.notEqual(await readFile(path.join(b,'dsh-ui-auth-sessions.json'),'utf8'),'instance-A-marker')
 savedLog('PASS data directory: default cwd, custom directory creation, session/audit placement, bootstrap deletion and instance separation')
} finally {
 console.log=savedLog
 if(original===undefined) delete process.env.DSH_AUTH_DATA_DIR; else process.env.DSH_AUTH_DATA_DIR=original
 await rm(root,{recursive:true,force:true})
}
