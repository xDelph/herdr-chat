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
    throw new Error(detail || `Réglage des notifications refusé (${String(response.status)})`);
  }
};

export const pushSupported =
  typeof window !== "undefined" &&
  "serviceWorker" in navigator &&
  "PushManager" in window &&
  "Notification" in window;

export const currentPushSubscription = async (): Promise<PushSubscription | null> => {
  if (!pushSupported) return null;
  const registration = await navigator.serviceWorker.getRegistration();
  if (registration === undefined) return null;
  return registration.pushManager.getSubscription();
};

export const enablePushNotifications = async (): Promise<void> => {
  if (!pushSupported)
    throw new Error("Ce navigateur ne prend pas en charge les notifications push.");
  const permission =
    Notification.permission === "default"
      ? await Notification.requestPermission()
      : Notification.permission;
  if (permission !== "granted") {
    throw new Error(
      permission === "denied"
        ? "Les notifications sont bloquées dans les réglages du navigateur."
        : "La permission de notifier n'a pas été accordée.",
    );
  }

  const registration = await navigator.serviceWorker.getRegistration();
  if (registration === undefined) {
    throw new Error(
      "Aucun service worker n'est enregistré. Installez d'abord l'app depuis le menu Partager, puis réessayez.",
    );
  }

  const existing = await registration.pushManager.getSubscription();
  if (existing !== null) {
    await subscriptionRequest(existing.toJSON());
    return;
  }

  const keyResponse = await fetch("/api/notifications/vapid-key", {
    cache: "no-store",
  });
  if (!keyResponse.ok) {
    throw new Error((await keyResponse.text()) || "Clé de notification indisponible.");
  }
  const key = (await keyResponse.text()).trim();
  if (key.length === 0) throw new Error("La clé de notification est vide.");

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
    throw new Error(
      "L'abonnement a été retiré du serveur, mais ce navigateur n'a pas pu se désabonner.",
    );
  }
};
