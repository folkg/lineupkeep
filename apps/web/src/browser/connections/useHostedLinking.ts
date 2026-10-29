import { useNavigate } from "@tanstack/solid-router";
import { createSignal, onCleanup } from "solid-js";
import type { Accessor } from "solid-js";

import type { ActionFeedbackState } from "#browser/shared-ui/ActionFeedback.tsx";
import type { StartHostedLinkingView } from "#contracts/connections/connectionContract.ts";
import {
  encodeHostedBrowserInput,
  maximumHostedBrowserTextLength,
  parseHostedBrowserMessage,
  viewportProfileForClientWidth,
} from "#contracts/connections/hostedBrowserProtocol.ts";
import type {
  HostedBrowserInput,
  HostedBrowserKey,
  HostedBrowserMessage,
  HostedBrowserRefusalReason,
  HostedBrowserStatus,
  HostedBrowserViewportProfile,
} from "#contracts/connections/hostedBrowserProtocol.ts";
import { defaultProviderKey, defaultProviderName } from "#contracts/connections/providerLabels.ts";

import { describeConnectionFailure } from "./connectionFailure";
import type { ConnectionRemote } from "./connectionRemote";

export function useHostedLinking(options: HostedLinkingOptions): HostedLinkingController {
  const [session, setSession] = createSignal<StartHostedLinkingView>();
  const [frameUrl, setFrameUrl] = createSignal<string>();
  const [status, setStatus] = createSignal<HostedBrowserStatus>("starting");
  const [failure, setFailure] = createSignal<ActionFeedbackState>();
  const [starting, setStarting] = createSignal(false);
  const [startingConnectionId, setStartingConnectionId] = createSignal<string>();
  const [ready, setReady] = createSignal(false);
  const [viewportProfile, setViewportProfile] =
    createSignal<HostedBrowserViewportProfile>("desktop");
  const navigate = useNavigate();
  let socket: WebSocket | undefined;
  let currentFrameUrl: string | undefined;
  let disposed = false;

  const closeSocket = (): void => {
    const active = socket;
    socket = undefined;
    active?.close();
  };

  const revokeFrame = (): void => {
    if (currentFrameUrl !== undefined) {
      URL.revokeObjectURL(currentFrameUrl);
      currentFrameUrl = undefined;
    }
    setFrameUrl(undefined);
  };

  const reportFailure = (error: unknown): void => {
    const described = describeConnectionFailure(error);
    setFailure({ type: "attention", message: described.message });
  };

  const cancel = (): void => {
    const current = session();
    closeSocket();
    revokeFrame();
    setSession(undefined);
    setReady(false);
    setStatus("starting");
    if (current !== undefined) {
      void options
        .remote()
        .cancelHosted({ id: current.session.id })
        .then(() => options.onRefresh())
        .catch(reportFailure);
    }
  };

  const finish = (message: "failed" | "expired"): void => {
    const current = session();
    closeSocket();
    revokeFrame();
    setSession(undefined);
    setReady(false);
    if (current !== undefined) {
      void options
        .remote()
        .cancelHosted({ id: current.session.id })
        .catch(() => undefined);
    }
    void options.onRefresh();
    if (message === "expired") {
      setFailure({
        type: "attention",
        message: `This sign-in session expired. Start again to reconnect ${defaultProviderName()}.`,
      });
    }
  };

  const handleMessage = (message: HostedBrowserMessage): void => {
    switch (message._tag) {
      case "Status":
        setStatus(message.status);
        return;
      case "AcceptsInput":
        return;
      case "Refused":
        setFailure({
          type: "attention",
          message: refusalMessage(message.host, message.reason),
        });
        return;
      case "Ready": {
        setReady(true);
        closeSocket();
        revokeFrame();
        setSession(undefined);
        void options
          .onRefresh()
          .then(() => navigate({ to: "/teams" }))
          .catch(() => undefined);
        return;
      }
      case "Failed":
        setFailure({
          type: "attention",
          message: failureMessage(message.reason),
        });
        finish("failed");
        return;
      case "Expired":
        finish("expired");
        return;
    }
  };

  const connect = (view: StartHostedLinkingView): void => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const socketUrl = `${protocol}//${window.location.host}${view.streamPath}`;
    const opened = new WebSocket(socketUrl);
    opened.binaryType = "arraybuffer";
    socket = opened;
    opened.onmessage = (event) => {
      if (socket !== opened) {
        return;
      }
      if (typeof event.data === "string") {
        const parsed = parseHostedBrowserMessage(event.data);
        if (parsed !== undefined) {
          handleMessage(parsed);
        }
        return;
      }
      if (event.data instanceof ArrayBuffer) {
        const next = URL.createObjectURL(new Blob([event.data], { type: "image/jpeg" }));
        if (currentFrameUrl !== undefined) {
          URL.revokeObjectURL(currentFrameUrl);
        }
        currentFrameUrl = next;
        setFrameUrl(next);
      }
    };
    opened.onclose = () => {
      if (socket !== opened) {
        return;
      }
      socket = undefined;
      if (!ready() && session() !== undefined) {
        setFailure({
          type: "attention",
          message: `The private browser disconnected. Start again to reconnect ${defaultProviderName()}.`,
        });
        finish("failed");
      }
    };
    opened.onerror = () => {
      if (socket === opened) {
        setFailure({
          type: "attention",
          message: "The private browser could not connect. Try again.",
        });
        cancel();
      }
    };
  };

  const start = (input: StartHostedLinkingOptions = {}): Promise<void> => {
    if (starting()) {
      return Promise.resolve();
    }
    setFailure(undefined);
    setReady(false);
    setStarting(true);
    if (input.connectionId !== undefined) {
      setStartingConnectionId(input.connectionId);
    }
    return options
      .remote()
      .startHosted({
        provider: defaultProviderKey,
        viewport: viewportProfileForClientWidth(window.innerWidth),
        ...(input.connectionId === undefined ? {} : { connectionId: input.connectionId }),
      })
      .then((view) => {
        if (disposed) {
          void options.remote().cancelHosted({ id: view.session.id });
          return;
        }
        setViewportProfile(view.viewport);
        setSession(view);
        setStatus("starting");
        connect(view);
      })
      .catch(reportFailure)
      .finally(() => {
        setStarting(false);
        setStartingConnectionId(undefined);
      });
  };

  const sendInput = (input: HostedBrowserInput): void => {
    if (socket?.readyState !== WebSocket.OPEN) {
      return;
    }
    socket.send(encodeHostedBrowserInput(input));
  };

  const sendText = (text: string): void => {
    for (const chunk of textChunks(text)) {
      sendInput({ _tag: "Text", text: chunk });
    }
  };

  onCleanup(() => {
    disposed = true;
    const current = session();
    closeSocket();
    revokeFrame();
    if (current !== undefined && !ready()) {
      void options
        .remote()
        .cancelHosted({ id: current.session.id })
        .catch(() => undefined);
    }
  });

  return {
    session,
    frameUrl,
    status,
    failure,
    starting,
    startingConnectionId,
    ready,
    viewportProfile,
    start,
    cancel,
    click: (x, y) => sendInput({ _tag: "Click", x, y }),
    sendText,
    sendKey: (key: HostedBrowserKey) => sendInput({ _tag: "Key", key }),
    scroll: (deltaY) => sendInput({ _tag: "Scroll", deltaY }),
  };
}

function textChunks(text: string): ReadonlyArray<string> {
  const chunks: Array<string> = [];
  for (let index = 0; index < text.length; index += maximumHostedBrowserTextLength) {
    chunks.push(text.slice(index, index + maximumHostedBrowserTextLength));
  }
  return chunks;
}

function refusalMessage(host: string, reason: HostedBrowserRefusalReason): string {
  switch (reason) {
    case "non_public_address":
      return `The private browser refused to connect to ${host} because it does not resolve to a public internet address.`;
    case "unresolvable":
      return `The private browser refused to connect to ${host} because the name could not be resolved.`;
    case "invalid_destination":
      return `The private browser refused to connect to ${host} because it is not a valid destination.`;
  }
}

function failureMessage(reason: HostedBrowserMessageFailure): string {
  switch (reason) {
    case "session_rejected":
      return `${defaultProviderName()} did not accept this session. Check the account and try again.`;
    case "provider_unavailable":
      return `${defaultProviderName()} could not be reached. Try again in a moment.`;
    case "browser_unavailable":
    case "page_unavailable":
      return "The private browser could not start. Try again.";
    case "expired":
      return `This sign-in session expired. Start again to reconnect ${defaultProviderName()}.`;
    case "completion_failed":
      return "We could not confirm the sign-in. Try again.";
  }
}

export function statusMessage(status: HostedBrowserStatus): string {
  switch (status) {
    case "starting":
      return "Starting a private browser session…";
    case "loading":
      return `Loading the ${defaultProviderName()} sign-in page…`;
    case "waiting":
      return "Finish signing in. This window updates automatically.";
    case "two-factor":
      return `${defaultProviderName()} asked for an additional verification step. Complete it here.`;
    case "blocked":
      return `${defaultProviderName()} blocked this sign-in. Cancel and try again.`;
  }
}

export type HostedLinkingController = {
  readonly session: Accessor<StartHostedLinkingView | undefined>;
  readonly frameUrl: Accessor<string | undefined>;
  readonly status: Accessor<HostedBrowserStatus>;
  readonly failure: Accessor<ActionFeedbackState | undefined>;
  readonly starting: Accessor<boolean>;
  readonly startingConnectionId: Accessor<string | undefined>;
  readonly ready: Accessor<boolean>;
  readonly viewportProfile: Accessor<HostedBrowserViewportProfile>;
  readonly start: (options?: StartHostedLinkingOptions) => Promise<void>;
  readonly cancel: () => void;
  readonly click: (x: number, y: number) => void;
  readonly sendText: (text: string) => void;
  readonly sendKey: (key: HostedBrowserKey) => void;
  readonly scroll: (deltaY: number) => void;
};

type HostedLinkingOptions = {
  readonly remote: Accessor<ConnectionRemote>;
  readonly onRefresh: () => Promise<void>;
};

type StartHostedLinkingOptions = {
  readonly connectionId?: string;
};

type HostedBrowserMessageFailure = Extract<HostedBrowserMessage, { _tag: "Failed" }>["reason"];
