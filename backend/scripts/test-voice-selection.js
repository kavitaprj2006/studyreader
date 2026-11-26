const assert = require('assert');

// Simulate the frontend gender matching logic
function resolveVoiceForSpeech(voiceId, availableVoices) {
  const isMale = /orion|apollo|atlas|guy|prabhat|male/i.test(voiceId);
  const desiredGender = isMale ? "male" : "female";
  let selectedVoice = null;

  // 1. Direct name match if browser voice
  if (voiceId && voiceId.startsWith("browser:")) {
    const rawTarget = voiceId.replace(/^browser:/, "").toLowerCase();
    const coreName = rawTarget.replace(/^[a-z]{2}-[a-z]{2}-/i, "").toLowerCase();
    selectedVoice = availableVoices.find(v => {
      const vName = (v.name || "").toLowerCase();
      const vUri = (v.voiceURI || "").toLowerCase();
      return vName === rawTarget || vUri === rawTarget || vName.includes(coreName);
    });
  }

  // 2. Gender matching if neural fallback or not found directly
  if (!selectedVoice && availableVoices.length > 0) {
    if (desiredGender === "female") {
      selectedVoice = availableVoices.find(v => /jenny|neerja|zira|swara|ava|emma|sonia|samantha|karen|victoria/i.test(v.name)) ||
                      availableVoices.find(v => /female/i.test(v.name)) ||
                      availableVoices.find(v => !/david|guy|male|mark|george|prabhat|madhur|ravi/i.test(v.name));
    } else {
      selectedVoice = availableVoices.find(v => /guy|david|prabhat|madhur|mark|george/i.test(v.name)) ||
                      availableVoices.find(v => /male/i.test(v.name));
    }
  }

  return { desiredGender, selectedVoice };
}

// Typical Windows voices: Microsoft David (Desktop, male), Microsoft Zira (Desktop, female)
const mockWindowsVoices = [
  { name: "Microsoft David Desktop - English (United States)", lang: "en-US" },
  { name: "Microsoft Zira Desktop - English (United States)", lang: "en-US" },
  { name: "Microsoft Jenny Online (Natural) - English (United States)", lang: "en-US" },
  { name: "Microsoft Guy Online (Natural) - English (United States)", lang: "en-US" },
  { name: "Microsoft Neerja Online (Natural) - English (India)", lang: "en-IN" }
];

console.log("==========================================");
console.log("TESTING VOICE SELECTION & GENDER RESOLUTION");
console.log("==========================================");

// Case 1: User selects Luna Female (or fallback from Luna Female)
const res1 = resolveVoiceForSpeech("cf:luna", mockWindowsVoices);
console.log("Luna Female resolved voice:", res1.selectedVoice.name);
assert(res1.desiredGender === "female");
assert(/jenny|zira|neerja/i.test(res1.selectedVoice.name), "Luna must resolve to female voice!");
assert(!/david|guy/i.test(res1.selectedVoice.name), "Luna Female must NEVER resolve to David or male!");
console.log("✔ Test 1 passed: Luna Female resolves to female voice (" + res1.selectedVoice.name + ")");

// Case 2: User selects Orion Male
const res2 = resolveVoiceForSpeech("cf:orion", mockWindowsVoices);
console.log("Orion Male resolved voice:", res2.selectedVoice.name);
assert(res2.desiredGender === "male");
assert(/guy|david/i.test(res2.selectedVoice.name), "Orion must resolve to male voice!");
console.log("✔ Test 2 passed: Orion Male resolves to male voice (" + res2.selectedVoice.name + ")");

// Case 3: User selects Microsoft Neerja (Indian English)
const res3 = resolveVoiceForSpeech("browser:en-IN-Neerja", mockWindowsVoices);
console.log("Neerja resolved voice:", res3.selectedVoice.name);
assert(/neerja/i.test(res3.selectedVoice.name), "Neerja must resolve to Neerja voice!");
console.log("✔ Test 3 passed: Neerja resolves to exact Neerja voice");

// Case 4: Legacy system with only David (male) and Zira (female)
const legacyVoices = [
  { name: "Microsoft David Desktop - English (United States)", lang: "en-US" },
  { name: "Microsoft Zira Desktop - English (United States)", lang: "en-US" }
];
const res4 = resolveVoiceForSpeech("cf:luna", legacyVoices);
console.log("Luna on legacy desktop resolved to:", res4.selectedVoice.name);
assert(res4.selectedVoice.name.includes("Zira"), "Must choose female Zira, never male David!");
console.log("✔ Test 4 passed: Luna on legacy system chooses Zira (Female), never David (Male)");

console.log("\nALL VOICE TESTS PASSED!");
