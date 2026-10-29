// Profile → Language. Pick a language and the whole app switches at once (no restart, nothing remounts, so the
// cart and any open form stay as they are). The sample card below shows the new language and ₹/date/time formats live.
import { View } from 'react-native';
import { Text } from '@/src/ui/text';
import { AccountLayout, accountStyles as s } from '@/src/components/account-layout';
import { LanguagePicker, useFormat, useTranslation } from '@/src/i18n';

export default function LanguageScreen() {
  const { t } = useTranslation();
  const fmt = useFormat();
  return <AccountLayout id="language" title={t('language.title')} subtitle={t('language.subtitle')}>
    <LanguagePicker />
    <View style={[s.card, { marginTop: 16 }]} testID="language-preview">
      <Text style={s.label}>{t('language.previewTitle')}</Text>
      <Text style={s.hint} accessibilityLiveRegion="polite">{t('language.previewOrder', { amount: fmt.money(1234.5), eta: fmt.eta(25) })}</Text>
      <Text style={s.hint}>{t('language.previewDate', { date: fmt.dateTime(new Date()) })}</Text>
    </View>
    <Text style={s.hint}>{t('language.storeNames')}</Text>
  </AccountLayout>;
}
