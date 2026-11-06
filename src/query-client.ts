// One QueryClient for the whole app; the provider in app/_layout.tsx uses
// this instance. Import it for cache calls outside components, for example
// queryClient.invalidateQueries or setQueryData in websocket or push
// handlers; inside components useQueryClient() returns this same instance.
import { focusManager, QueryClient } from "@tanstack/react-query";
import { AppState, Platform, type AppStateStatus } from "react-native";

export const queryClient = new QueryClient();

// On a phone "focused" means the app is in the foreground: refetchOnWindowFocus fires when the app comes back, and
// refetchInterval pauses while it is in the background. The web keeps react-query's own visibility listener.
if (Platform.OS !== "web") {
  focusManager.setEventListener(setFocused => {
    const sub = AppState.addEventListener("change", (state: AppStateStatus) => setFocused(state === "active"));
    return () => sub.remove();
  });
}
