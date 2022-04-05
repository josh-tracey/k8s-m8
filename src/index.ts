import { Transform } from "stream";
import * as tty from "tty";
import { V1ContainerState } from "@kubernetes/client-node";

import * as k8s from "@kubernetes/client-node";
import { Context } from "@kubernetes/client-node/dist/config_types";

export const sleep = (ms: number) => {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
};

export const colorStatus = (status?: string) => {
  if (status === "Running") {
    return `${FgLightGreen}${status}${Reset}`;
  } else if (status === "Succeeded") {
    return `${FgGreen}${status}${Reset}`;
  } else if (
    status === "Failed" ||
    status === "Terminating" ||
    status === "Terminated"
  ) {
    return `${FgRed}${status}${Reset}`;
  }
  return status || "Unknown";
};

export const findState = (state: V1ContainerState) => {
  if (state.running) {
    return "Running";
  } else if (state.terminated) {
    return "Terminating";
  } else if (state.waiting) {
    return "Waiting";
  } else {
    return "Unknown";
  }
};

export const FgRed = "\x1b[31m";
export const FgYellow = "\x1b[33m";
export const Reset = "\x1b[0m";
export const FgGreen = "\x1b[32m";
export const FgLightGreen = "\x1b[92m";
export const FgBlue = "\x1b[34m";
export const FgGrey = "\x1b[37m";

export const k8sAgent = (api: IK8sApi) => {
  let namespace: string | undefined = "default";

  const getCurrentNamespace = () => {
    return namespace || "default";
  };

  const waitForPodReady = (
    name: string,
    namespace: string,
    options?: {
      interval?: number;
      onReady?: (name: string, namespace: string) => void;
    }
  ) => {
    return new Promise<void>(async (done, error) => {
      let podReady = false;
      while (!podReady) {
        const podStatus = (
          await api.k8sCore.readNamespacedPodStatus(name, namespace)
        ).body;
        if (["Ready", "Running"].includes(podStatus.status?.phase!)) {
          podReady = true;
        } else if (
          ["Completed", "Failed", "Terminating"].includes(
            podStatus.status?.phase!
          )
        ) {
          error("Pods in failed/completed state.");
        }
        sleep(options?.interval || 2000);
      }
      done();
    });
  };

  const getPod = (pod: string, namespace: string) => {
    return api.k8sCore.readNamespacedPod(pod, namespace);
  };

  const execShell = (
    podName: string,
    namespace: string,
    shell: string = "bash"
  ) => {
    return new Promise<void>(async (done, error) => {
      const ttyInput = new tty.ReadStream(0);
      ttyInput.setRawMode(true);

      const pod = await getPod(podName, namespace);

      const containerName = pod.body.spec?.containers[0].name || "";

      const res = await api.k8sExec.exec(
        namespace,
        podName,
        containerName,
        shell,
        new tty.WriteStream(1),
        process.stderr,
        ttyInput,
        true /* tty */,
        () => {
          done();
        }
      );

      res.on("close", () => {
        done();
      });

      res.on("error", (err) => {
        error(err);
      });
    });
  };

  const getNamespaces = async () => {
    try {
      return api.k8sCore.listNamespace();
    } catch (e) {
      console.log((e as Error).message);
      return;
    }
  };

  const setNamespace = async (nextNamespace: string) => {
    namespace = nextNamespace;
  };

  const getServices = async (namespace: string) => {
    try {
      return api.k8sCore.listNamespacedService(namespace);
    } catch (e) {
      console.log((e as Error).message);
      return;
    }
  };

  const getPods = (namespace: string) => {
    return api.k8sCore.listNamespacedPod(namespace);
  };

  const getDeployments = async (namespace: string) => {
    return api.k8sApps.listNamespacedDeployment(namespace);
  };

  const setScaleDeployment = async (
    name: string,
    namespace: string,
    replicas: number
  ) => {
    try {
      return await api.k8sApps
        .replaceNamespacedDeploymentScale(name, namespace, {
          spec: { replicas },
          metadata: { name, namespace },
        })
        .then((response) => response)
        .catch((error) => {
          console.log(error);
          return error;
        });
    } catch (e) {
      console.log((e as Error).message);
      return;
    }
  };

  const getDeploymentDetails = async (name: string, namespace: string) => {
    try {
      return (await api.k8sApps.readNamespacedDeployment(name, namespace)).body;
    } catch (e) {
      console.log((e as Error).message);
      return;
    }
  };

  const getAllDeployments = () => {
    try {
      return api.k8sApps.listDeploymentForAllNamespaces();
    } catch (e) {
      console.log((e as Error).message);
      return;
    }
  };

  const getSecrets = (namespace: string) => {
    return api.k8sCore.listNamespacedSecret(namespace);
  };

  const getConfigMaps = (namespace: string) => {
    return api.k8sCore.listNamespacedConfigMap(namespace);
  };

  const getServiceAccounts = (namespace: string) => {
    return api.k8sCore.listNamespacedServiceAccount(namespace);
  };

  const getJobs = (namespace: string) => {
    return api.k8sBatchV1.listNamespacedJob(namespace);
  };

  const getCronJobs = (namespace: string) => {
    return api.k8sBatchV1.listNamespacedCronJob(namespace);
  };

  const getSecret = async (name: string, namespace: string) => {
    return (await api.k8sCore.readNamespacedSecret(name, namespace)).body;
  };

  const getConfigmap = async (name: string, namespace: string) => {
    return (await api.k8sCore.readNamespacedConfigMap(name, namespace)).body;
  };

  const getPodStatus = async (pod: string, namespace: string) => {
    const podStatus = (
      await api.k8sCore.readNamespacedPodStatus(pod, namespace)
    ).body;

    return {
      podName: pod,
      phase: colorStatus(podStatus.status?.phase),
      lastCondition: colorStatus(
        findState(
          podStatus.status?.containerStatuses![
            podStatus.status?.containerStatuses?.length! - 1
          ].state!
        )
      ),
    };
  };

  const getServiceProxy = async (service: string, namespace: string) => {
    return (
      await api.k8sCore.connectGetNamespacedServiceProxy(service, namespace)
    ).body;
  };

  const getPodLogs = async (pod: string, namespace: string) => {
    const logTimestampLOCALRegex = /(\d{4}-\d{2}-\d{2}[A-Z]\d{2}:\d{2}:\d{2}\.\d{1,12}\+\d{2}:\d{2}) (.*)/gu;
    const logTimestampGTCRegex = /(\d{4}-\d{2}-\d{2}[A-Z]\d{2}:\d{2}:\d{2}\.\d{1,12}[A-Z]) (.*)/gu;
    try {
      const logs = (
        await api.k8sCore.readNamespacedPodLog(
          pod,
          namespace,
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
      ).body;

      const matchs = logs.match(/(.*)/gu);

      if (matchs)
        return matchs.map((line: string) => {
          let match = logTimestampLOCALRegex.exec(line);
          if (match === null) {
            match = logTimestampGTCRegex.exec(line);
          }
          return match;
        });

      throw Error("Found No Logs!");
    } catch (e) {
      if ((e as Error).message.includes("HTTP request failed")) {
        console.log("Failed to retrieve logs!");
      } else {
        console.log(e);
      }
      return;
    }
  };
  const streamLog = async (
    podName: string,
    namespace: string,
    writer: Transform
  ) => {
    const pod = await api.k8sCore.readNamespacedPod(podName, namespace);

    const streams = await Promise.all(
      pod.body.spec?.containers.map(async (container) => {
        return api.k8sLogs.log(
          namespace,
          podName,
          container?.name || "",
          writer,
          (err: any) => {
            console.log(err);
          },
          { follow: true, sinceSeconds: 120, timestamps: true }
        );
      }) || []
    );
    return streams;
  };

  const showPodDetails = async (namespace: string, name: string) => {
    const pod = await api.k8sCore.readNamespacedPod(name, namespace);
    return pod.body;
  };

  const configMapExists = async (name: string, namespace: string) => {
    const configMaps = await api.k8sCore.listNamespacedConfigMap(namespace);
    return !!configMaps.body.items.find(
      (configmap) => configmap.metadata?.name === name
    );
  };

  const createConfigmap = async (
    name: string,
    namespace: string,
    data: { [name: string]: string }
  ) => {
    await api.k8sCore.createNamespacedConfigMap(namespace, {
      data,
      metadata: { name },
    });
  };

  const updateConfigmap = async (
    name: string,
    namespace: string,
    data: { [name: string]: string }
  ) => {
    await api.k8sCore.patchNamespacedConfigMap(
      name,
      namespace,
      {
        data: data,
      },
      undefined,
      undefined,
      undefined,
      undefined,
      {
        headers: {
          "content-type": "application/merge-patch+json",
        },
      }
    );
  };

  const deleteResource = (
    resourceType: ResourceType,
    namespace: string,
    name: string
  ) => {
    if (resourceType === "pods") {
      return api.k8sCore.deleteNamespacedPod(name, namespace);
    } else if (resourceType === "deployments") {
      return api.k8sApps.deleteNamespacedDeployment(name, namespace);
    } else if (resourceType === "daemonsets") {
      return api.k8sApps.deleteNamespacedDaemonSet(name, namespace);
    } else if (resourceType === "services") {
      return api.k8sCore.deleteNamespacedService(name, namespace);
    } else if (resourceType === "secrets") {
      return api.k8sCore.deleteNamespacedSecret(name, namespace);
    } else if (resourceType === "configMaps") {
      return api.k8sCore.deleteNamespacedConfigMap(name, namespace);
    } else if (resourceType === "serviceAccounts") {
      return api.k8sCore.deleteNamespacedServiceAccount(name, namespace);
    }
    return;
  };

  return {
    getNamespaces,
    getDeployments,
    getJobs,
    getCronJobs,
    getSecret,
    getConfigmap,
    getPodStatus,
    getServiceProxy,
    getPodLogs,
    streamLog,
    showPodDetails,
    configMapExists,
    createConfigmap,
    updateConfigmap,
    deleteResource,
    getDeploymentDetails,
    setNamespace,
    getServiceAccounts,
    getServices,
    getPods,
    getConfigMaps,
    getSecrets,
    getAllDeployments,
    setScaleDeployment,
    waitForPodReady,
    getCurrentNamespace,
    execShell,
  };
};

export const getK8sApis = (k8config: k8s.KubeConfig) => {
  type EventApi = k8s.EventsV1Api | k8s.EventsV1beta1Api;

  let k8sLogs = new k8s.Log(k8config);

  let k8sExec = new k8s.Exec(k8config);

  let k8sBatchV1 = k8config.makeApiClient(k8s.BatchV1Api);

  let k8sCustomApi = k8config.makeApiClient(k8s.ApiextensionsV1Api);

  let k8sCore = k8config.makeApiClient(k8s.CoreV1Api);

  let k8sApps = k8config.makeApiClient(k8s.AppsV1Api);

  let k8sEvents: EventApi = k8config.makeApiClient(k8s.EventsV1Api);

  let getCurrentContext = () => k8config.getCurrentContext();

  const getContexts = () =>
    k8config.getContexts().map((context: Context) => ({
      name: context.name,
      cluster: context.cluster,
      user: context.user,
    }));

  const setContext = async (context: string) => {
    k8config.setCurrentContext(context);
    await reinitApis();
  };
  const reinitApis = async () => {
    const eventVersion = await k8config
      .makeApiClient(k8s.EventsApi)
      .getAPIGroup();

    k8sLogs = new k8s.Log(k8config);
    k8sBatchV1 = k8config.makeApiClient(k8s.BatchV1Api);
    k8sCustomApi = k8config.makeApiClient(k8s.ApiextensionsV1Api);
    k8sCore = k8config.makeApiClient(k8s.CoreV1Api);
    k8sApps = k8config.makeApiClient(k8s.AppsV1Api);

    if (eventVersion.body.preferredVersion?.version === "v1") {
      k8sEvents = k8config.makeApiClient(k8s.EventsV1Api);
    } else {
      k8sEvents = k8config.makeApiClient(k8s.EventsV1beta1Api);
    }
    k8sExec = new k8s.Exec(k8config);
  };
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
  };
};

export type IK8sApi = ReturnType<typeof getK8sApis>;
export type IK8Agent = ReturnType<typeof k8sAgent>;
export declare type ResourceType =
  | "pods"
  | "namespaces"
  | "deployments"
  | "daemonsets"
  | "services"
  | "secrets"
  | "configMaps"
  | "serviceAccounts"
  | "jobs"
  | "cronJobs";
