/**
 * FileWatcher.ts
 * This file is not used due to inability to clean up inotifywait processes
 */
import { v1 } from "@docker/extension-api-client-types"

const allWatches: { [key: string]: any } = {}

const getUser = async (client: v1.DockerDesktopClient) => {
    const result = await client.docker.cli.exec('run', ['--rm', '-e', 'USER', 'alpine:latest', 'sh', '-c', `"echo $USER"`])
    return result.stdout.trim()
}

export const readFileInPromptsVolume = async (client: v1.DockerDesktopClient, path: string) => {
    const result = await client.docker.cli.exec('run', ['--rm', '-v', 'docker-prompts:/docker-prompts', '--workdir', '/docker-prompts', 'alpine:latest', 'sh', '-c', `"cat ${path}"`])
    return result.stdout
}

export const writeFileToPromptsVolume = async (client: v1.DockerDesktopClient, content: string) => {
    // Workaround for inability to use shell operators w/ DD extension API, use write_files image
    const result = await client.docker.cli.exec('run', ['--rm', '-v', 'docker-prompts:/docker-prompts', '--workdir', '/docker-prompts', 'vonwig/function_write_files:latest', `'${content}'`])
    return result.stdout
}

export const writeFilesToHost = async (client: v1.DockerDesktopClient, files: { path: string, content: string }[], hostPaths: { source: string, target: string }[], workdir: string) => {
    const bindArgs = hostPaths.map(path => `--mount type=bind,source="${path.source}",target="${path.target}"`)
    const args = ['--rm', ...bindArgs, '--workdir', workdir, 'vonwig/function_write_files:latest', `'${JSON.stringify({ files })}'`]
    console.log('args', `docker run ${args.join(' ')}`)
    const result = await client.docker.cli.exec('run', args)
    if (result.stderr) {
        console.error(result.stderr)
    }
    return result.stdout
}

export const watchFile = async (client: v1.DockerDesktopClient, path: string, stream: { onOutput: (data: { stdout?: string; stderr?: string }) => void, onError: (error: string) => void, onClose: (exitCode: number) => void }, host = false) => {
    let user: string | undefined
    if (host) {
        user = await getUser(client)
    }
    return new Promise((resolve, reject) => {
        let args = ['--rm', 'vonwig/inotifywait:latest', '-e', 'modify', '-e', 'create', '-e', 'delete', '-q', '-m']
        if (host) {
            const replacedPath = path.replace(`$USER`, user!)
            args = ['--mount', `type=bind,source=${replacedPath},target=/config.json`, ...args, '/config.json']
        }
        else {
            args = ['-v', 'docker-prompts:/docker-prompts', '--workdir', '/docker-prompts', ...args, path]
        }
        console.log('starting watch', path)
        if (path in allWatches) {
            console.log('stopping duplicate watch', path)
            allWatches[path].close()
            delete allWatches[path]
        }
        allWatches[path] = client.docker.cli.exec('run', args, {
            stream: {
                onOutput: (data) => {
                    stream.onOutput(data)
                },
                onError: (error) => {
                    stream.onError(error)
                    console.log('error', error)
                },
                onClose: (exitCode: number) => {
                    stream.onClose(exitCode)
                    console.log('close', exitCode)
                }
            }
        })
        console.log('allWatches', allWatches)
    })

}

export const stopWatch = (path: string) => {
    if (allWatches[path]) {
        console.log('stopping watch', path)
        allWatches[path].close()
        delete allWatches[path]
    }
}

export const stopAllWatches = () => {
    Object.keys(allWatches).forEach(path => {
        console.log('stopping watch', path)
        stopWatch(path)
    })
}