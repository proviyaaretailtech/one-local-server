// App side of the order Live Activity (lock screen + Dynamic Island). The UI lives in the widget
// extension (targets/widget/OrderLiveActivity.swift). Null outside an iOS development build.
import { requireOptionalNativeModule } from 'expo-modules-core';

type OneCityLiveActivity = {
  areEnabled(): boolean;
  start(orderId: string, status: string, step: number, etaEndMs: number, summary: string): Promise<string | null>;
  update(orderId: string, status: string, step: number, etaEndMs: number, summary: string): Promise<void>;
};

export default requireOptionalNativeModule<OneCityLiveActivity>('OneCityLiveActivity');
