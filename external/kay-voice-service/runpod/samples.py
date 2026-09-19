"""Fixed first-sample catalog; arbitrary text is intentionally not accepted."""

SAMPLE_TEXTS = {
    "sample_1": "مساء الخير أستاذ طارق، معك كاي. حبيت أحكي معك دقيقتين عن متابعة العملاء اليوم.",
    "sample_2": "سامر، عندك اليوم أربع متابعات مهمة. خلينا نبدأ بالعملاء اللي وعدتهم ترجع تحكي معهم.",
    "sample_3": "تمام، فهمت عليك. رح أرجع أتحقق من المتابعة، وإذا في شي بحاجة لقرار من الإدارة رح أرفعلك توصية فقط.",
}

VOICE_PROFILES = {
    "A": {
        "name": "calm professional",
        "description": "male, Arabic, Levantine/Syrian leaning, calm, natural, professional, not theatrical",
        "controls": {"exaggeration": 0.35, "cfg_weight": 0.55, "temperature": 0.65},
    },
    "B": {
        "name": "warm conversational",
        "description": "male, Arabic, Levantine/Syrian leaning, warm, natural, conversational, not robotic",
        "controls": {"exaggeration": 0.55, "cfg_weight": 0.45, "temperature": 0.80},
    },
    "C": {
        "name": "confident supervisor",
        "description": "male, Arabic, Levantine/Syrian leaning, confident, professional, natural, not theatrical",
        "controls": {"exaggeration": 0.25, "cfg_weight": 0.70, "temperature": 0.55},
    },
}

TTS_MODEL = "oddadmix/lahgtna-chatterbox-v1"