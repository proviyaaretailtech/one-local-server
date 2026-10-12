import { Text, View } from 'react-native';
import Icon from '@react-native-vector-icons/ionicons';
import { AccountLayout, accountStyles as s } from '@/src/components/account-layout';
import { colors } from '@/src/theme';
import { useTranslation } from '@/src/i18n';
export default function About() { const { t } = useTranslation(); return <AccountLayout id="about" title={t('about.title')} subtitle={t('about.madeIn')}><View style={s.card}><Icon name="storefront-outline" size={38} color={colors.shops} /><Text testID="about-story" style={s.title}>{t('about.story')}</Text><Text style={s.hint}>{t('about.storyBody')}</Text></View><View style={s.card}><Text style={s.title}>{t('about.experienceTitle')}</Text><Text testID="about-sample-notice" style={s.hint}>{t('about.sampleNotice')}</Text><Text testID="about-privacy" style={s.hint}>{t('about.privacyNotice')}</Text><Text testID="about-version" style={s.hint}>{t('about.version')}</Text></View></AccountLayout>; }