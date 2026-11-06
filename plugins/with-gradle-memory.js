// Release builds run lint-vital and then R8 in the same Gradle daemon. With the template's 512 MB metaspace, R8 stopped
// with "Metaspace" on the 2026-10-31 production .aab, so this raises the daemon's metaspace to 1 GB on every
// `expo prebuild`. The heap and any other daemon flags stay as the template sets them.
const { withGradleProperties } = require('expo/config-plugins');

const METASPACE = '-XX:MaxMetaspaceSize=1024m';

module.exports = function withGradleMemory(config) {
  return withGradleProperties(config, cfg => {
    const jvm = cfg.modResults.find(item => item.type === 'property' && item.key === 'org.gradle.jvmargs');
    if (!jvm) cfg.modResults.push({ type: 'property', key: 'org.gradle.jvmargs', value: `-Xmx2048m ${METASPACE}` });
    else jvm.value = /-XX:MaxMetaspaceSize=\S+/.test(jvm.value) ? jvm.value.replace(/-XX:MaxMetaspaceSize=\S+/, METASPACE) : `${jvm.value} ${METASPACE}`;
    return cfg;
  });
};
