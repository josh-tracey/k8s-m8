import { Readable, Transform } from 'stream'
import * as tty from 'tty'
import {
  V1ConfigMap,
  V1ConfigMapList,
  V1ContainerState,
  V1CronJobList,
  V1DaemonSet,
  V1DaemonSetList,
  V1Deployment,
  V1DeploymentList,
  V1Job,
  V1JobList,
  V1Namespace,
  V1Pod,
  V1PodList,
  V1Scale,
  V1Secret,
  V1SecretList,
  V1Service,
  V1ServiceAccount,
  V1ServiceAccountList,
  V1ServiceList,
  V1StatefulSet,
  V1StatefulSetList,
} from '@kubernetes/client-node'


import * as k8s from '@kubernetes/client-node'
import { Context } from '@kubernetes/client-node/dist/config_types'
import Case = require('case')

export const sleep = (ms: number) => {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

export const colorStatus = (status?: string) => {
  if (status === 'Running') {
    return `${FgLightGreen}${status}${Reset}`
  } else if (status === 'Succeeded') {
    return `${FgGreen}${status}${Reset}`
  } else if (
    status === 'Failed' ||
    status === 'Terminating' ||
    status === 'Terminated'
  ) {
    return `${FgRed}${status}${Reset}`
  }
  return status || 'Unknown'
}

export const findState = (state: V1ContainerState) => {
  if (state.running) {
    return 'Running'
  } else if (state.terminated) {
    return 'Terminating'
  } else if (state.waiting) {
    return 'Waiting'
  } else {
    return 'Unknown'
  }
}

export const FgRed = '\x1b[31m'
export const FgYellow = '\x1b[33m'
export const Reset = '\x1b[0m'
export const FgGreen = '\x1b[32m'
export const FgLightGreen = '\x1b[92m'
export const FgBlue = '\x1b[34m'
export const FgGrey = '\x1b[37m'

export const k8sAgent = (k8config: k8s.KubeConfig) =>
  Client(getK8sApis(k8config))

export const Client = (api: IK8sApi) => {
  let namespace: string = 'default'

  const getCurrentNamespace = () => {
    return namespace || 'default'
  }

  const waitForPodReady = (
    name: string,
    _namespace?: string,
    options?: {
      interval?: number
      onReady?: (name: string, namespace: string) => void
    }
  ) => {
    return new Promise<void>(async (done, error) => {
      let podReady = false
      while (!podReady) {
        const podStatusResult = await api.k8sCore
          .readNamespacedPodStatus(name, _namespace || namespace)
          .catch((err) => {
            error(`k8sCore.readNamespacedPodStatus => ${err}`)
          })
        if (podStatusResult) {
          const podStatus = podStatusResult.body
          if (['Ready', 'Running'].includes(podStatus.status?.phase!)) {
            podReady = true
          } else if (
            ['Completed', 'Failed', 'Terminating'].includes(
              podStatus.status?.phase!
            )
          ) {
            error('Pods in failed/completed state.')
          }
          sleep(options?.interval || 2000)
        }
        done()
      }
    })
  }

  const getPod = (pod: string, _namespace?: string) => {
    return new Promise<V1Pod>(async (done, error) => {
      const podResult = await api.k8sCore
        .readNamespacedPod(pod, _namespace || namespace)
        .catch((err) => {
          error(`k8sCore.readNamespacedPod => ${err}`)
        })
      if (podResult) {
        done(podResult.body)
      }
    })
  }
 
  const execShell = (
    podName: string,
    shell: string = 'bash',
    _namespace?: string
  ) => {
    return new Promise<void>(async (done, error) => {
      const ttyInput = new tty.ReadStream(0)
      ttyInput.setRawMode(true)

      const pod = await getPod(podName, _namespace || namespace).catch(
        (err) => {
          error(`getPod => ${err}`)
        }
      )

      if (!pod) {
        error('Pod not found.')
      }

      const containerName = pod!.spec?.containers[0].name || ''

      const res = await api.k8sExec
        .exec(
          _namespace || namespace,
          podName,
          containerName,
          shell,
          new tty.WriteStream(1),
          process.stderr,
          ttyInput,
          true /* tty */,
          () => {
            done()
          }
        )
        .catch((err: Error) => {
          error(`k8sExec.exec => ${err}`)
        })

      res!.on('close', () => {
        done()
      })

      res!.on('error', (err: Error) => {
        error(`k8sExec.exec => ${err}`)
      })
    })
  }

  const getNamespaces = () => {
    return new Promise<V1Namespace>(async (done, error) => {
      const namespacesResult = await api.k8sCore
        .listNamespace()
        .catch((err: Error) => {
          error(`k8sCore.listNamespace => ${err}`)
        })
      if (namespacesResult) {
        done(namespacesResult.body)
      }
    })
  }

  const setNamespace = (nextNamespace: string) => {
    namespace = nextNamespace
  }

  const getServices = (_namespace?: string) => {
    return new Promise<V1ServiceList>(async (done, error) => {
      const servicesResult = await api.k8sCore
        .listNamespacedService(_namespace || namespace)
        .catch((err: Error) => {
          error(`k8sCore.listNamespacedService => ${err}`)
        })
      if (servicesResult) {
        done(servicesResult.body)
      }
    })
  }

  const getPods = (_namespace?: string) => {
    return new Promise<V1PodList>(async (done, error) => {
      const podResults = await api.k8sCore
        .listNamespacedPod(_namespace || namespace)
        .catch((err: Error) => {
          error(`k8sCore.listNamespacedPod => ${err}`)
        })
      if (podResults) {
        done(podResults.body)
      }
    })
  }

  const getDeployments = (_namespace?: string) => {
    return new Promise<V1DeploymentList>(async (done, error) => {
      const deploymentsResult = await api.k8sApps
        .listNamespacedDeployment(_namespace || namespace)
        .catch((err: Error) => {
          error(`k8sApps.listNamespacedDeployment => ${err}`)
        })
      if (deploymentsResult) {
        done(deploymentsResult.body)
      }
    })
  }

  const setScaleDeployment = (
    name: string,
    replicas: number,
    _namespace?: string
  ) => {
    return new Promise<V1Scale>(async (done, error) => {
      const scaleResult = await api.k8sApps
        .replaceNamespacedDeploymentScale(name, _namespace || namespace, {
          spec: { replicas },
          metadata: { name, namespace: _namespace || namespace },
        })
        .catch((err: Error) => {
          error(`k8sApps.replaceNamespacedDeploymentScale => ${err}`)
        })
      if (scaleResult) {
        done(scaleResult.body)
      }
    })
  }

  const getDeploymentDetails = (name: string, _namespace?: string) => {
    return new Promise<V1Deployment>(async (done, error) => {
      const deploymentResult = await api.k8sApps
        .readNamespacedDeployment(name, _namespace || namespace)
        .catch((err: Error) => {
          error(`k8sApps.readNamespacedDeployment => ${err}`)
        })
      if (deploymentResult) {
        done(deploymentResult.body)
      }
    })
  }

  const getAllDeployments = () => {
    return new Promise<V1DeploymentList>(async (done, error) => {
      const deploymentsResult = await api.k8sApps
        .listDeploymentForAllNamespaces()
        .catch((err: Error) => {
          error(`k8sApps.listDeploymentForAllNamespaces => ${err}`)
        })
      if (deploymentsResult) {
        done(deploymentsResult.body)
      }
    })
  }

  const getSecrets = (_namespace?: string) => {
    return new Promise<V1SecretList>(async (done, error) => {
      const secretsResult = await api.k8sCore
        .listNamespacedSecret(_namespace || namespace)
        .catch((err: Error) => {
          error(`k8sCore.listNamespacedSecret => ${err}`)
        })
      if (secretsResult) {
        done(secretsResult.body)
      }
    })
  }

  const getConfigMaps = (_namespace?: string) => {
    return new Promise<V1ConfigMapList>(async (done, error) => {
      const configMapsResult = await api.k8sCore
        .listNamespacedConfigMap(_namespace || namespace)
        .catch((err: Error) => {
          error(`k8sCore.listNamespacedConfigMap => ${err}`)
        })
      if (configMapsResult) {
        done(configMapsResult.body)
      }
    })
  }

  const getServiceAccounts = (_namespace?: string) => {
    return new Promise<V1ServiceAccountList>(async (done, error) => {
      const serviceAccountsResult = await api.k8sCore
        .listNamespacedServiceAccount(_namespace || namespace)
        .catch((err: Error) => {
          error(`k8sCore.listNamespacedServiceAccount => ${err}`)
        })
      if (serviceAccountsResult) {
        done(serviceAccountsResult.body)
      }
    })
  }

  const getJobs = (_namespace?: string) => {
    return new Promise<V1JobList>(async (done, error) => {
      const jobsResult = await api.k8sBatchV1
        .listNamespacedJob(_namespace || namespace)
        .catch((err: Error) => {
          error(`k8sBatchV1.listNamespacedJob => ${err}`)
        })
      if (jobsResult) {
        done(jobsResult.body)
      }
    })
  }

  const getCronJobs = (_namespace?: string) => {
    return new Promise<V1CronJobList>(async (done, error) => {
      const cronJobsResult = await api.k8sBatchV1
        .listNamespacedCronJob(_namespace || namespace)
        .catch((err: Error) => {
          error(`k8sBatchV1.listNamespacedCronJob => ${err}`)
        })
      if (cronJobsResult) {
        done(cronJobsResult.body)
      }
    })
  }

  const getJob = (name: string, _namespace?: string) => {
    return new Promise<V1Job>(async (done, error) => {
      const jobResult = await api.k8sBatchV1
        .readNamespacedJob(name, _namespace || namespace)
        .catch((err: Error) => {
          error(`k8sBatchV1.readNamespacedJob => ${err}`)
        })
      if (jobResult) {
        done(jobResult.body)
      }
    })
  }

  const getServiceAccount = (name: string, _namespace?: string) => {
    return new Promise<V1ServiceAccount>(async (done, error) => {
      const serviceAccountResult = await api.k8sCore
        .readNamespacedServiceAccount(name, _namespace || namespace)
        .catch((err: Error) => {
          error(`k8sCore.readNamespacedServiceAccount => ${err}`)
        })
      if (serviceAccountResult) {
        done(serviceAccountResult.body)
      }
    })
  }

  const getDeployment = (name: string, _namespace?: string) => {
    return new Promise<V1Deployment>(async (done, error) => {
      const deploymentResult = await api.k8sApps
        .readNamespacedDeployment(name, _namespace || namespace)
        .catch((err: Error) => {
          error(`k8sApps.readNamespacedDeployment => ${err}`)
        })
      if (deploymentResult) {
        done(deploymentResult.body)
      }
    })
  }

  const getDaemonSet = (name: string, _namespace?: string) => {
    return new Promise<V1DaemonSet>(async (done, error) => {
      const daemonSetResult = await api.k8sApps
        .readNamespacedDaemonSet(name, _namespace || namespace)
        .catch((err: Error) => {
          error(`k8sApps.readNamespacedDaemonSet => ${err}`)
        })
      if (daemonSetResult) {
        done(daemonSetResult.body)
      }
    })
  }

  const getDaemonSets = (_namespace?: string) => {
    return new Promise<V1DaemonSetList>(async (done, error) => {
      const daemonSetsResult = await api.k8sApps
        .listNamespacedDaemonSet(_namespace || namespace)
        .catch((err: Error) => {
          error(`k8sApps.listNamespacedDaemonSet => ${err}`)
        })
      if (daemonSetsResult) {
        done(daemonSetsResult.body)
      }
    })
  }

  const getStatefulSet = (name: string, _namespace?: string) => {
    return new Promise<V1StatefulSet>(async (done, error) => {
      const statefulSetResult = await api.k8sApps
        .readNamespacedStatefulSet(name, _namespace || namespace)
        .catch((err: Error) => {
          error(`k8sApps.readNamespacedStatefulSet => ${err}`)
        })
      if (statefulSetResult) {
        done(statefulSetResult.body)
      }
    })
  }

  const getStatefulSets = (_namespace?: string) => {
    return new Promise<V1StatefulSetList>(async (done, error) => {
      const statefulSetsResult = await api.k8sApps
        .listNamespacedStatefulSet(_namespace || namespace)
        .catch((err: Error) => {
          error(`k8sApps.listNamespacedStatefulSet => ${err}`)
        })
      if (statefulSetsResult) {
        done(statefulSetsResult.body)
      }
    })
  }

  const getService = (name: string, _namespace?: string) => {
    return new Promise<V1Service>(async (done, error) => {
      const serviceResult = await api.k8sCore
        .readNamespacedService(name, _namespace || namespace)
        .catch((err: Error) => {
          error(`k8sCore.readNamespacedService => ${err}`)
        })
      if (serviceResult) {
        done(serviceResult.body)
      }
    })
  }

  const getSecret = (name: string, _namespace?: string) => {
    return new Promise<V1Secret>(async (done, error) => {
      const secretResult = await api.k8sCore
        .readNamespacedSecret(name, _namespace || namespace)
        .catch((err: Error) => {
          error(`k8sCore.readNamespacedSecret => ${err}`)
        })
      if (secretResult) {
        done(secretResult.body)
      }
    })
  }

  const getConfigmap = (name: string, _namespace?: string) => {
    return new Promise<V1ConfigMap>(async (done, error) => {
      const configmapResult = await api.k8sCore
        .readNamespacedConfigMap(name, _namespace || namespace)
        .catch((err: Error) => {
          error(`k8sCore.readNamespacedConfigMap => ${err}`)
        })
      if (configmapResult) {
        done(configmapResult.body)
      }
    })
  }

  const getPodStatus = (pod: string, _namespace?: string) => {
    return new Promise<{
      podName: string
      phase: string
      lastCondition?: string
    }>(async (done, error) => {
      const podStatusResult = await api.k8sCore
        .readNamespacedPodStatus(pod, _namespace || namespace)
        .catch((err: Error) => {
          error(`k8sCore.readNamespacedPodStatus => ${err}`)
        })
      if (podStatusResult) {
        done({
          podName: podStatusResult.body!.metadata!.name!,
          phase: colorStatus(podStatusResult.body.status?.phase),
          lastCondition: colorStatus(
            findState(
              podStatusResult.body.status?.containerStatuses![
                podStatusResult.body.status?.containerStatuses?.length! - 1
              ].state!
            )
          ),
        })
      }
    })
  }

  const getServiceProxy = (service: string, _namespace?: string) => {
    return new Promise<any>(async (done, error) => {
      const serviceProxyResult = await api.k8sCore
        .connectGetNamespacedServiceProxy(service, _namespace || namespace)
        .catch((err: Error) => {
          error(`k8sCore.connectGetNamespacedServiceProxy => ${err}`)
        })
      if (serviceProxyResult) {
        done(serviceProxyResult.body)
      }
    })
  }

  const getPodLogs = async (pod: string, _namespace?: string) => {
    const logTimestampLOCALRegex = /(\d{4}-\d{2}-\d{2}[A-Z]\d{2}:\d{2}:\d{2}\.\d{1,12}\+\d{2}:\d{2}) (.*)/gu
    const logTimestampGTCRegex = /(\d{4}-\d{2}-\d{2}[A-Z]\d{2}:\d{2}:\d{2}\.\d{1,12}[A-Z]) (.*)/gu
    try {
      const logs = (
        await api.k8sCore.readNamespacedPodLog(
          pod,
          _namespace || namespace,
          undefined,
          false,
          false,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          true
        )
      ).body

      const matchs = logs.match(/(.*)/gu)

      if (matchs)
        return matchs.map((line: string) => {
          let match = logTimestampLOCALRegex.exec(line)
          if (match === null) {
            match = logTimestampGTCRegex.exec(line)
          }
          return match
        })

      throw Error('Found No Logs!')
    } catch (e) {
      if ((e as Error).message.includes('HTTP request failed')) {
        console.log('Failed to retrieve logs!')
      } else {
        console.log(e)
      }
      return
    }
  }

  const streamLog = async (
    podName: string,
    namespace: string,
    writer: Transform
  ) => {
    const pod = await getPod(podName, namespace).catch((e) => {
      throw e
    })

    const streams = await Promise.all(
      pod.spec?.containers.map(async (container) => {
        return api.k8sLogs.log(
          namespace,
          podName,
          container?.name || '',
          writer,
          (err: any) => {
            console.log(err)
          },
          { follow: true, sinceSeconds: 120, timestamps: true }
        )
      }) || []
    )
    return streams
  }

  const showPodDetails = (name: string, _namespace?: string) => {
    return new Promise<V1Pod>(async (done, error) => {
      const podResult = await api.k8sCore
        .readNamespacedPod(name, _namespace || namespace)
        .catch((err: Error) => {
          error(`k8sCore.readNamespacedPod => ${err}`)
        })
      if (podResult) {
        done(podResult.body)
      }
    })
  }

  const configMapExists = (name: string, _namespace?: string) => {
    return new Promise<boolean>(async (done, error) => {
      const configMapsResult = await api.k8sCore
        .listNamespacedConfigMap(_namespace || namespace)
        .catch((err: Error) => {
          error(`k8sCore.listNamespacedConfigMap => ${err}`)
        })
      if (configMapsResult) {
        done(
          !!configMapsResult.body.items.find(
            (configmap) => configmap.metadata?.name === name
          )
        )
      }
    })
  }

  const secretExists = (name: string, _namespace?: string) => {
    return new Promise<boolean>(async (done, error) => {
      const secretsResult = await api.k8sCore
        .listNamespacedSecret(_namespace || namespace)
        .catch((err: Error) => {
          error(`k8sCore.listNamespacedSecret => ${err}`)
        })
      if (secretsResult) {
        done(
          !!secretsResult.body.items.find(
            (secret) => secret.metadata?.name === Case.kebab(name)
          )
        )
      }
    })
  }

  const createConfigmap = (
    name: string,
    value: string,
    _namespace?: string
  ) => {
    return new Promise<V1ConfigMap>(async (done, error) => {
      const configmapResult = await api.k8sCore
        .createNamespacedConfigMap(_namespace || namespace, {
          data: { [name]: value },
          metadata: {
            name: Case.kebab(name),
            namespace: _namespace || namespace,
          },
        })
        .catch((err: Error) => {
          error(`k8sCore.createNamespacedConfigMap => ${err}`)
        })
      if (configmapResult) {
        done(configmapResult.body)
      }
    })
  }

  const createConfigmapFromStream = (
    name: string,
    data: { filename: string; stream: Readable }[],
    _namespace?: string
  ) => {
    return new Promise<V1ConfigMap>(async (done, error) => {
      let _data = {}
      try {
        for (const file of data) {
          for await (const chunk of file.stream) {
            if (!_data[file.filename]) {
              _data[file.filename] = ''
            }
            _data[file.filename] += chunk.toString()
          }
        }
      } catch (e) {
        error(e)
      }
      const configmapResult = await api.k8sCore
        .createNamespacedConfigMap(_namespace || namespace, {
          data: _data,
          metadata: {
            name: Case.kebab(name),
            namespace: _namespace || namespace,
          },
        })
        .catch((err: Error) => {
          error(`k8sCore.createNamespacedConfigMap => ${err}`)
        })
      if (configmapResult) {
        done(configmapResult.body)
      }
    })
  }

  const updateConfigmapFromStream = (
    name: string,
    data: { filename: string; stream: Readable }[],
    _namespace?: string
  ) => {
    return new Promise<V1ConfigMap>(async (done, error) => {
      let _data = {}
      try {
        for (const file of data) {
          for await (const chunk of file.stream) {
            if (!_data[file.filename]) {
              _data[file.filename] = ''
            }
            _data[file.filename] += chunk.toString()
          }
        }
      } catch (e) {
        error(e)
      }

      const _name = Case.kebab(name)

      const configmapResult = await api.k8sCore
        .replaceNamespacedConfigMap(_name, _namespace || namespace, {
          data: _data,
          metadata: {
            name: _name,
            namespace: _namespace || namespace,
          },
        })
        .catch((err: Error) => {
          error(`k8sCore.replaceNamespacedConfigMap => ${err}`)
        })
      if (configmapResult) {
        done(configmapResult.body)
      }
    })
  }

  const createOrUpdateConfigmapFromStream = async (
    name: string,
    data: { filename: string; stream: Readable }[],
    _namespace?: string
  ) => {
    if (!(await configMapExists(name, _namespace))) {
      return createConfigmapFromStream(name, data, _namespace).catch((e) => {
        throw `createConfigmapFromStream => ${e}`
      })
    } else {
      return updateConfigmapFromStream(name, data, _namespace).catch((e) => {
        throw `updateConfigmapFromStream => ${e}`
      })
    }
  }

  const updateSecret = (name: string, value: string, _namespace?: string) => {
    return new Promise<V1Secret>(async (done, error) => {
      const secretResult = await api.k8sCore
        .replaceNamespacedSecret(Case.kebab(name), _namespace || namespace, {
          type: 'Opaque',
          data: { [name]: Buffer.from(value, 'utf-8').toString('base64') },
          metadata: {
            name: Case.kebab(name),
            namespace: _namespace || namespace,
          },
        })
        .catch((err: Error) => {
          error(`k8sCore.replaceNamespacedSecret => ${err}`)
        })
      if (secretResult) {
        done(secretResult.body)
      }
    })
  }

  const createSecret = (name: string, value: string, _namespace?: string) => {
    return new Promise<V1Secret>(async (done, error) => {
      const secretResult = await api.k8sCore
        .createNamespacedSecret(_namespace || namespace, {
          type: 'Opaque',
          data: { [name]: Buffer.from(value, 'utf-8').toString('base64') },
          metadata: {
            name: Case.kebab(name),
            namespace: _namespace || namespace,
          },
        })
        .catch((err: Error) => {
          error(`k8sCore.createNamespacedSecret => ${err}`)
        })
      if (secretResult) {
        done(secretResult.body)
      }
    })
  }

  const createOrUpdateSecret = async (
    name: string,
    value: string,
    _namespace?: string
  ) => {
    try {
      const secretExistsResult = await secretExists(name, _namespace).catch(
        (e) => {
          throw `createOrUpdateSecret:secretExists => ${e}`
        }
      )
      if (secretExistsResult) {
        await updateSecret(name, value, _namespace).catch((e) => {
          throw `createOrUpdateSecret:updateSecret => ${e}`
        })
      } else {
        await createSecret(name, value, _namespace).catch((e) => {
          throw `createOrUpdateSecret:createSecret => ${e}`
        })
      }
    } catch (e) {
      throw e
    }
  }

  const updateConfigmap = (
    name: string,
    data: { [name: string]: string },
    _namespace?: string
  ) => {
    return new Promise<V1ConfigMap>(async (done, error) => {
      const configmapResult = await api.k8sCore
        .patchNamespacedConfigMap(
          name,
          _namespace || namespace,
          {
            data: data,
          },
          undefined,
          undefined,
          undefined,
          undefined,
          {
            headers: {
              'content-type': 'application/merge-patch+json',
            },
          }
        )
        .catch((err: Error) => {
          error(`k8sCore.patchNamespacedConfigMap => ${err}`)
        })
      if (configmapResult) {
        done(configmapResult.body)
      }
    })
  }

  const deleteResource = (
    resourceType: ResourceType,
    name: string,
    _namespace?: string
  ) => {
    if (resourceType === 'pods') {
      return api.k8sCore.deleteNamespacedPod(name, _namespace || namespace)
    } else if (resourceType === 'deployments') {
      return api.k8sApps.deleteNamespacedDeployment(
        name,
        _namespace || namespace
      )
    } else if (resourceType === 'daemonsets') {
      return api.k8sApps.deleteNamespacedDaemonSet(
        name,
        _namespace || namespace
      )
    } else if (resourceType === 'services') {
      return api.k8sCore.deleteNamespacedService(name, _namespace || namespace)
    } else if (resourceType === 'secrets') {
      return api.k8sCore.deleteNamespacedSecret(name, _namespace || namespace)
    } else if (resourceType === 'configMaps') {
      return api.k8sCore.deleteNamespacedConfigMap(
        name,
        _namespace || namespace
      )
    } else if (resourceType === 'serviceAccounts') {
      return api.k8sCore.deleteNamespacedServiceAccount(
        name,
        _namespace || namespace
      )
    }
    return
  }

  const waitForRequiredPod = async (
    podShortName: string,
    _pods?: V1PodList
  ) => {
    try {
      let podName: string | undefined

      if (_pods) {
        podName = _pods.items.find((pod) =>
          pod.metadata!.name!.includes(podShortName)
        )?.metadata?.name
      } else {
        podName = await getPods()
          .then(
            (pods) =>
              pods.items.find((pod) =>
                pod?.metadata?.name?.includes(podShortName)
              )?.metadata!.name
          )
          .catch((err) => {
            throw new Error(`waitForRequiredPod.getPods => ${err}`)
          })
      }
      if (podName) {
        await waitForPodReady(podName).catch((err) => {
          throw new Error(`waitForRequiredPod.waitForPodReady => ${err}`)
        })
      } else {
        throw new Error(`${podShortName} pod not found`)
      }
    } catch (err) {
      throw err
    }
  }

  const waitForPods = async (podShortNames: string[]) => {
    const pods = await getPods()
    for await (const podShortName of podShortNames) {
      await waitForRequiredPod(podShortName, pods).catch((err) => {
        throw new Error(`waitForPods.waitForRequiredPod => ${err}`)
      })
    }
  }

  return {
    configMapExists,
    createConfigmap,
    createConfigmapFromStream,
    createOrUpdateConfigmapFromStream,
    createOrUpdateSecret,
    createSecret,
    deleteResource,
    execShell,
    getAllDeployments,
    getConfigMaps,
    getConfigmap,
    getCronJobs,
    getCurrentNamespace,
    getDaemonSet,
    getDaemonSets,
    getDeployment,
    getDeploymentDetails,
    getDeployments,
    getJob,
    getJobs,
    getNamespaces,
    getPodLogs,
    getPodStatus,
    getPods,
    getSecret,
    getSecrets,
    getService,
    getServiceAccount,
    getServiceAccounts,
    getServiceProxy,
    getServices,
    getStatefulSet,
    getStatefulSets,
    secretExists,
    setNamespace,
    setScaleDeployment,
    showPodDetails,
    streamLog,
    updateConfigmap,
    updateConfigmapFromStream,
    updateSecret,
    waitForPodReady,
    waitForPods,
    waitForRequiredPod,
  }
}

export const getK8sApis = (k8config: k8s.KubeConfig) => {
  type EventApi = k8s.EventsV1Api | k8s.EventsV1beta1Api

  let k8sLogs = new k8s.Log(k8config)

  let k8sExec = new k8s.Exec(k8config)

  let k8sBatchV1 = k8config.makeApiClient(k8s.BatchV1Api)

  let k8sCustomApi = k8config.makeApiClient(k8s.ApiextensionsV1Api)

  let k8sCore = k8config.makeApiClient(k8s.CoreV1Api)

  let k8sApps = k8config.makeApiClient(k8s.AppsV1Api)

  let k8sEvents: EventApi = k8config.makeApiClient(k8s.EventsV1Api)

  let getCurrentContext = () => k8config.getCurrentContext()

  const getContexts = () =>
    k8config.getContexts().map((context: Context) => ({
      name: context.name,
      cluster: context.cluster,
      user: context.user,
    }))

  const setContext = async (context: string) => {
    k8config.setCurrentContext(context)
    await reinitApis()
  }
  const reinitApis = async () => {
    const eventVersion = await k8config
      .makeApiClient(k8s.EventsApi)
      .getAPIGroup()

    k8sLogs = new k8s.Log(k8config)
    k8sBatchV1 = k8config.makeApiClient(k8s.BatchV1Api)
    k8sCustomApi = k8config.makeApiClient(k8s.ApiextensionsV1Api)
    k8sCore = k8config.makeApiClient(k8s.CoreV1Api)
    k8sApps = k8config.makeApiClient(k8s.AppsV1Api)

    if (eventVersion.body.preferredVersion?.version === 'v1') {
      k8sEvents = k8config.makeApiClient(k8s.EventsV1Api)
    } else {
      k8sEvents = k8config.makeApiClient(k8s.EventsV1beta1Api)
    }
    k8sExec = new k8s.Exec(k8config)
  }
  return {
    k8sLogs,
    k8sBatchV1,
    k8sCustomApi,
    k8sCore,
    k8sApps,
    k8sEvents,
    k8sExec,
    getCurrentContext,
    getContexts,
    setContext,
  }
}

export type IK8sApi = ReturnType<typeof getK8sApis>
export type IK8Agent = ReturnType<typeof k8sAgent>
export declare type ResourceType =
  | 'pods'
  | 'namespaces'
  | 'deployments'
  | 'daemonsets'
  | 'services'
  | 'secrets'
  | 'configMaps'
  | 'serviceAccounts'
  | 'jobs'
  | 'cronJobs'
