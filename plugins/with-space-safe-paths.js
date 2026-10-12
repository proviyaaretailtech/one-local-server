// The project lives under a folder whose name contains spaces ("One Local Mobile App ").
// Two build steps from upstream templates run a script path without quoting it, so the shell
// splits it at the spaces and the iOS build fails:
//   1. pod script phases: bash -l -c "…$PODS_TARGET_SRCROOT/../scripts/x.sh"   (expo-constants)
//   2. the app's "Bundle React Native code and images" phase: `"$NODE_BINARY" --print "…react-native-xcode.sh"`
// This plugin re-quotes both on every `expo prebuild`, so renaming the folder is never needed.
const { withPodfile, withXcodeProject } = require('expo/config-plugins');

const MARKER = '# [onecity] quote pod script paths (folder name has spaces)';
const RUBY = `
  ${MARKER}
  installer.pods_project.targets.each do |target|
    target.shell_script_build_phases.each do |phase|
      script = phase.shell_script
      fixed = script.gsub(/bash -l -c "([^"]*?)\\$PODS_TARGET_SRCROOT\\/([^"\\s]+\\.sh)"/) { "bash -l -c \\"#{$1}\\\\\\"$PODS_TARGET_SRCROOT/#{$2}\\\\\\"\\"" }
      phase.shell_script = fixed if fixed != script
    end
  end
  installer.pods_project.save
`;

function withQuotedPodScripts(config) {
  return withPodfile(config, cfg => {
    if (!cfg.modResults.contents.includes(MARKER)) {
      cfg.modResults.contents = cfg.modResults.contents.replace(/post_install do \|installer\|\n/, match => match + RUBY);
    }
    return cfg;
  });
}

// `…` runs the printed path unquoted; "$(…)" keeps it one word. (In the parsed project the script's
// quotes are stored escaped as \".)
function withQuotedBundleScript(config) {
  return withXcodeProject(config, cfg => {
    const phases = cfg.modResults.hash.project.objects.PBXShellScriptBuildPhase || {};
    for (const phase of Object.values(phases)) {
      if (!phase || typeof phase !== 'object' || typeof phase.shellScript !== 'string') continue;
      if (!String(phase.name || '').includes('Bundle React Native code and images')) continue;
      phase.shellScript = phase.shellScript.replace(/`(\\"\$NODE_BINARY\\" --print [^`]*?react-native-xcode\.sh'\\")`/, '\\"$($1)\\"');
    }
    return cfg;
  });
}

module.exports = function withSpaceSafePaths(config) {
  return withQuotedBundleScript(withQuotedPodScripts(config));
};
