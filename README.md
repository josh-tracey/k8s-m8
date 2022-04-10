## k8s-m8

### Example

Create some secets and some configmaps from some files 

```typescript

import * as fs from 'fs'
import { IK8Agent, k8sAgent } from '@adriftdev/k8s-m8'
import { KubeConfig } from '@kubernetes/client-node'

const kubeConfig = process.env.KUBECONFIG

export let k8sClient: IK8Agent | undefined


if (kubeConfig && exists(kubeConfig)) {
  const k8config = new KubeConfig()
  k8config.loadFromFile(kubeConfig)
  k8sClient = k8sAgent(k8config)
}

const kube = () => { 
  return new Promise<void>(async (resolve, reject) => {
    try {
      if (k8sClient) {
         await k8sClient
            .createOrUpdateSecret('Test', 'super Secret :P ')
            .catch((err) => {
            throw new Error(err)
          })

          await k8sClient
            .createOrUpdateSecret('Test', 'NNah wrong password')
            .catch((err) => {
            throw new Error(err)
          })

          await k8sClient.createOrUpdateConfigmapFromStream('someConfig', [
            { filename: 'config', stream: fs.createReadStream('kube/config') },
            { filename: 'config1', stream: fs.createReadStream('.env') },
            { filename: 'config2', stream: fs.createReadStream('.gitignore') },
          ])
          resolve()
        } 
        catch (err) {
        reject(`Failed to initialise: ${err}`)
      }
  })
}

```


