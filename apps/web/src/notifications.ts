const applicationServerKey = (encoded: string): Uint8Array<ArrayBuffer> => {
  const padded = `${encoded}${"=".repeat((4 - (encoded.length % 4)) % 4)}`;
  const binary = window.atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  const key = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) {
    key[index] = binary.charCodeAt(index);
  }
  return key;
};

const subscriptionRequest = async (body: unknown): Promise<void> => {
  const response = await fetch("/api/notifications/subscriptions", {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(
      detail || `Could not update notification settings (${String(response.status)})`,
    );
  }
};

export const pushSupported =
  typeof window !== "undefined" &&
  "serviceWorker" in navigator &&
  "PushManager" in window &&
  "Notification" in window;

export const currentPushSubscription = async (): Promise<PushSubscription | null> => {
  if (!pushSupported) return null;
  const registration = await navigator.serviceWorker.ready;
  return registration.pushManager.getSubscription();
};

export const enablePushNotifications = async (): Promise<void> => {
  if (!pushSupported) throw new Error("This browser does not support push notifications.");
  const permission =
    Notification.permission === "default"
      ? await Notification.requestPermission()
      : Notification.permission;
  if (permission !== "granted") {
    throw new Error(
      permission === "denied"
        ? "Notifications are blocked in browser settings."
        : "Notification permission was not granted.",
    );
  }

  const registration = await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();
  if (existing !== null) {
    await subscriptionRequest(existing.toJSON());
    return;
  }

  const keyResponse = await fetch("/api/notifications/vapid-key", {
    cache: "no-store",
  });
  if (!keyResponse.ok) {
    throw new Error((await keyResponse.text()) || "Could not configure push notifications.");
  }
  const key = (await keyResponse.text()).trim();
  if (key.length === 0) throw new Error("The push notification key is missing.");

  const subscription = await registration.pushManager.subscribe({
    applicationServerKey: applicationServerKey(key),
    userVisibleOnly: true,
  });
  try {
    await subscriptionRequest(subscription.toJSON());
  } catch (cause) {
    await subscription.unsubscribe();
    throw cause;
  }
};

export const disablePushNotifications = async (): Promise<void> => {
  const subscription = await currentPushSubscription();
  if (subscription === null) return;
  await subscriptionRequest({ unsubscribe: subscription.endpoint });
  if (!(await subscription.unsubscribe())) {
    throw new Error("The server subscription was removed, but this browser could not unsubscribe.");
  }
};
