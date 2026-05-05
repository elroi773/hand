import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'

const children = []
let shuttingDown = false

mkdirSync('/tmp/hand-book-demo-matplotlib', { recursive: true })

const env = {
  ...process.env,
  MPLCONFIGDIR: process.env.MPLCONFIGDIR ?? '/tmp/hand-book-demo-matplotlib',
}

function start(name, command, args) {
  const child = spawn(command, args, {
    env,
    stdio: 'inherit',
  })

  children.push(child)

  child.on('exit', (code, signal) => {
    if (shuttingDown) {
      return
    }

    shuttingDown = true
    children.forEach((item) => {
      if (item !== child) {
        item.kill('SIGTERM')
      }
    })

    if (signal) {
      process.kill(process.pid, signal)
      return
    }

    process.exit(code ?? 0)
  })

  child.on('error', (error) => {
    console.error(`${name} failed to start:`, error.message)
    process.exit(1)
  })
}

function shutdown() {
  shuttingDown = true
  children.forEach((child) => child.kill('SIGTERM'))
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

start('backend', 'python3', ['-m', 'uvicorn', 'backend.app:app', '--reload', '--port', '8000'])
start('frontend', 'npm', ['run', 'dev'])
