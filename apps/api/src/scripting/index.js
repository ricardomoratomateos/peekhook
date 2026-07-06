import { RunScript } from './app/RunScript.js'
import { NodeVmRunner } from './infra/nodeVmRunner.js'

const scriptRunner = new NodeVmRunner()
const runScript    = new RunScript({ runner: scriptRunner })

export { scriptRunner, runScript, RunScript, NodeVmRunner }
