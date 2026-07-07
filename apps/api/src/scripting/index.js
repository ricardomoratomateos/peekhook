import { RunScript } from './app/RunScript.js'
import { WorkerThreadRunner } from './infra/workerThreadRunner.js'

const scriptRunner = new WorkerThreadRunner()
const runScript    = new RunScript({ runner: scriptRunner })

export { scriptRunner, runScript, RunScript, WorkerThreadRunner }
