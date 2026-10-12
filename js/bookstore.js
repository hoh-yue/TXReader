/**
 * TXReader 书城与小说搜索模块
 * 基于追书神器 API 规范实现，包含 CORS 代理与智能书库降级机制
 */

const BOOKSTORE_PROXY_KEY = "shiyue-bookstore-proxy";
const DEFAULT_PROXY_URL = "https://novel-proxy.hohyue.workers.dev/";
const DEFAULT_API_BASE = "https://api.zhuishushenqi.com";
const DEFAULT_CHAPTER_BASE = "https://chapterup.zhuishushenqi.com";
const STATIC_COVER_BASE = "https://statics.zhuishushenqi.com";

// 内置热门经典书库数据（当外部 API 受 CORS 或网络限制时，提供可靠的搜索与完整阅读体验）
const BUILTIN_NOVELS = [
  {
    _id: "builtin_dldl",
    title: "斗罗大陆",
    author: "唐家三少",
    cat: "玄幻",
    majorCate: "玄幻",
    latelyFollower: 280000,
    retentionRatio: "91.2%",
    shortIntro:
      "唐门外门弟子唐三，因偷学内门绝学为唐门所不容，跳崖明志时却发现没有死，反而以另外一个身份来到了另一个世界：一个属于武魂的世界，名叫斗罗大陆。",
    cover: "https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=300",
    wordCount: 3000000,
    lastChapter: "第三百三十六章 完美融合之双神战双神（大结局）",
    chapters: [
      {
        title: "第一章 穿越的唐三",
        content:
          "巴蜀，历来有天府之国的美誉，其中最著名的门派，莫过于唐门。\n\n唐门外门弟子唐三，站在鬼见愁悬崖边，微风吹拂着他那青色的衣衫。\n\n偷学内门绝学《玄天宝录》，本是门规所不容的死罪。但他从未想过背叛唐门，此时此刻，他赤裸坦荡，将佛怒唐莲交还宗门，纵身一跃，跳下了深不见底的万丈深渊！\n\n当他再次睁开双眼时，却发现自己变成了一个嗷嗷待哺的婴儿，降生在一个名叫圣魂村的小山村中。\n\n这里，没有魔法，没有斗气，也没有武术，却有一种神奇的存在——武魂！",
      },
    ],
  },
  {
    _id: "builtin_dfdgr",
    title: "大奉打更人",
    author: "卖报小郎君",
    cat: "仙侠",
    majorCate: "仙侠",
    latelyFollower: 310000,
    retentionRatio: "94.0%",
    shortIntro:
      "这个世界，有儒；有道；有佛；有妖；有术士。警校毕业的许七安幽幽醒来，发现自己身处牢狱之中，三日后便要发配边陲…为了自救，他凭借现代刑侦手段破获奇案，一步步走上巅峰！",
    cover: "https://images.unsplash.com/photo-1534447677768-be436bb09401?w=300",
    wordCount: 3800000,
    lastChapter: "尾声以及完本感言",
    chapters: [
      {
        title: "第一章 牢狱之灾",
        content:
          "许七安是在一阵阵剧烈的头痛中苏醒过来的。\n\n阴暗潮湿的牢房，腐朽发霉的稻草，刺鼻的尿臊味弥漫在空气中。\n\n“我不是酒精中毒在抢救吗…这里是哪里？”\n\n记忆如潮水般涌入脑海，他穿越了，成了大奉京兆府下辖长乐县的一名不良人，而且因二叔丢失朝廷税银一案，全家被打入死牢，三日后便要斩首发配！\n\n身为前刑警的许七安眼中闪过一丝锐芒：“税银在密闭的官船上不翼而飞？落水化作白银碎屑？呵，这分明是化学置换反应与障眼法！老子要自救！”",
      },
    ],
  },
  {
    _id: "builtin_wm",
    title: "完美世界",
    author: "辰东",
    cat: "玄幻",
    majorCate: "玄幻",
    latelyFollower: 270000,
    retentionRatio: "90.5%",
    shortIntro:
      "一粒尘可填海，一根草斩尽日月星辰，弹指间天翻地覆。群雄并起，万族林立，诸圣争霸，乱天动地。问苍茫大地，谁主沉浮？！",
    cover: "https://images.unsplash.com/photo-1516979187457-637abb4f9353?w=300",
    wordCount: 6580000,
    lastChapter: "第两千零十四章 独断万古（大结局）",
    chapters: [
      {
        title: "第一章 朝阳中的石村",
        content:
          "大荒无垠，山脉巍峨，洪荒猛兽在莽林深处嘶吼咆哮。\n\n石村坐落在苍莽群山之间，四周古木参天，巨大的雷击木立在村口，只剩下一根焦黑的老树桩，却顽强地生出了一条嫩绿欲滴的柳条。\n\n在一群光着膀子晨练的强壮汉子中间，一个一岁多的小不点正摇摇晃晃地奔跑着，嘴角还残留着兽奶的白沫，大眼睛清澈乌黑，煞是可爱。\n\n谁也不会料到，这个在大荒村落里喝兽奶长大的幼童‘荒’，未来将横推万古，独断天渊！",
      },
    ],
  },
  {
    _id: "builtin_jl",
    title: "剑来",
    author: "烽火戏诸侯",
    cat: "仙侠",
    majorCate: "仙侠",
    latelyFollower: 290000,
    retentionRatio: "93.0%",
    shortIntro:
      "大千世界，无奇不有。我陈平安，唯有一剑，可搬山，倒海，降妖，镇魔，敕神，摘星，断江，摧城，开天！",
    cover: "https://images.unsplash.com/photo-1512820790803-83ca734da794?w=300",
    wordCount: 11000000,
    lastChapter: "更新中",
    chapters: [
      {
        title: "第一章 惊蛰",
        content:
          "小镇有锁龙井，井口覆着厚重的铁八卦。\n\n草鞋少年陈平安背着竹篓，手里拿着一根削尖的青竹杖，走在青石板路上。\n\n爹娘早逝，少年吃百家饭长大，替人烧瓷，替人送信，性子坚韧沉静如古井无波。\n\n在这方被圣人封禁气运的小天地里，各方仙家宗门大修士悄然降临，寻找着属于自己的无上机缘。而那个满手老茧的草鞋泥腿子，正一步一个脚印，走出一条震烁千古的剑仙大道！",
      },
    ],
  },
  {
    _id: "builtin_qyn",
    title: "庆余年",
    author: "猫腻",
    cat: "都市",
    majorCate: "都市",
    latelyFollower: 250000,
    retentionRatio: "89.8%",
    shortIntro:
      "积善之家，必有余庆。一个年轻的病人，因为一次毫不意外的经历，重生到了一个完全不同的世界。澹州海港的小少年范闲，即将踏入波谲云诡的庆国京都…",
    cover: "https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?w=300",
    wordCount: 3980000,
    lastChapter: "后记以及结局",
    chapters: [
      {
        title: "第一章 脱胎换骨",
        content:
          "澹州是一座依山傍海的小城。\n\n海风吹拂着港口的渔船，五竹背着黑色铁钎，手里牵着一个清秀安静的小男孩，缓缓走在咸湿的街道上。\n\n范闲抬起头，看着眼前这片陌生的世界。上一世重症肌无力瘫痪在床的痛苦记忆犹新，而今生拥有健康的躯体，能自由奔跑呼吸，已是上天最大的恩赐。\n\n他笑了笑，握紧了五竹叔冰凉粗糙的手。京都的繁华与杀机，监察院的阴冷与权力，终将在他脚下翻云覆雨！",
      },
    ],
  },
  {
    _id: "builtin_dpcq",
    title: "斗破苍穹",
    author: "天蚕土豆",
    cat: "玄幻",
    majorCate: "玄幻",
    latelyFollower: 248900,
    retentionRatio: "89.4%",
    shortIntro:
      "这里是属于斗气的世界，没有花俏艳丽的魔法，有的，仅仅是繁衍到巅峰的斗气！三十年河东，三十年河西，莫欺少年穷！",
    cover: "https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?w=300",
    wordCount: 5320000,
    lastChapter: "第一千六百四十一章 结束，也是开始（大结局）",
    chapters: [
      {
        title: "第一章 陨落的天才",
        content: `“斗之力，三段！”\n\n望着测验魔石碑上面闪亮得甚至有些刺眼的五个大字，少年面无表情，唇角有着一抹自嘲，紧握的手掌，因为大力，而导致略微尖锐的指甲深深的刺进了掌心之中，带来一阵阵钻心的疼痛…\n\n“萧炎，斗之力，三段！级别：低级！”测验魔石碑之旁，一位中年男子，看了一眼碑上所显示出来的信息，语气漠然的将之公布了出来…\n\n中年男子话刚脱口，便是不出意料的在人头汹涌的广场上带起了一阵嘲讽的骚动。\n\n“三段？嘿嘿，果然不出我所料，这个‘天才’这一年又是在原地踏步！”\n\n“哎，这废物真是把家族的脸都给丢光了。”\n\n“要不是族长是他的父亲，这种废物，早就被驱赶出家族，任其自生自灭了，哪同样还有资格待在家族中白吃白喝。”\n\n周围传来的嘲讽声与惋惜叹息，落在少年的耳中，宛如一根根毒针一般刺入心脏，让得少年的身躯微微颤抖。\n\n萧炎缓缓抬起头，露出一张清秀稚嫩的脸庞，深邃的黑眸略微有些空洞。四年前，他是萧家百年难遇的绝顶天才，十一岁便突破至十段斗之力，凝聚斗之气旋，成为家族有史以来最年轻的斗者！\n\n然而，整整三年前，天才的光环却在巅峰时刻戛然而止。体内凝聚的斗之气旋莫名消散，辛辛苦苦修炼出来的斗之气，更是随着岁月流逝而诡异消失…\n\n少年深吸了一口气，转身漠然向着人群外走去。孤独的背影，在夕阳下拉得长长的，显得萧索而落寞。`,
      },
      {
        title: "第二章 斗气大陆",
        content: `萧炎缓缓走回后山，双手枕在脑后，躺在松软的草地上，凝视着蔚蓝的天空。\n\n这里，名为斗气大陆。没有绚丽繁复的魔法，唯有繁衍到了巅峰状态的纯正斗气！\n\n在斗气大陆，斗气的修炼等级有着森严的划分：斗之力、斗者、斗师、大斗师、斗灵、斗王、斗皇、斗宗、斗尊、斗圣，乃至那存在于传说之中、移山倒海的斗帝！\n\n每一个阶别，皆是如同天堑般的鸿沟，不知阻拦了多少惊才绝艳之辈。\n\n萧炎低头看向自己右手手指上佩戴的一枚黑色古朴铁戒，那是母亲离世前留给他的唯一遗物。\n\n“三年了…母亲，难道炎儿真的注定要成为一个庸人吗？”萧炎苦涩低语。\n\n就在此刻，那枚平平无奇的黑色戒指上，忽然泛起了一丝极其微弱的荧光，宛如从沉睡中苏醒…`,
      },
      {
        title: "第三章 药老",
        content: `“嘿嘿，小娃娃，看来你怨气不小啊？”\n\n突兀的声音，冷不丁在空旷的山顶上响彻而起，令萧炎浑身毛孔瞬间倒竖！\n\n“谁？！”萧炎猛地翻身站起，漆黑的眸子如猎豹般警惕地扫视四周。\n\n“不用找了，老夫就在你的手指上。”苍老中带着几分戏谑的声音再次传来。\n\n萧炎目光惊疑不定地移向右手的黑色铁戒。只见那古戒之上幽芒一闪，一团虚幻透明的苍老身影，缓缓从戒指中漂浮升腾而起！\n\n老者须发皆白，身着一袭宽大的白袍，神态悠闲中透着一抹深不可测的威严。\n\n“你…你是人是鬼？我的斗气消失，难道也是你搞的鬼？！”萧炎瞳孔收缩，厉声喝道。\n\n“咳咳…小家伙倒是敏锐。不错，这三年来若非吸收了你每日修炼而来的纯净斗气，老夫这缕残魂，恐怕早就随风消散了。”老者捻了捻胡须，有些不好意思地笑道。\n\n“王八蛋！你还我斗气！还我三年天才光阴！”萧炎双眼瞬间通红，怒吼着一拳砸了过去…`,
      },
    ],
  },
  {
    _id: "builtin_gmzz",
    title: "诡秘之主",
    author: "爱潜水的乌贼",
    cat: "奇幻",
    majorCate: "奇幻",
    latelyFollower: 295000,
    retentionRatio: "92.1%",
    shortIntro:
      "蒸汽与机械的浪潮中，谁能触及非凡？历史和黑暗的迷雾里，又是谁在耳语？我从诡秘中醒来，睁眼看见这个世界：枪械，巨舰，飞空艇，魔药，占卜，诅咒，塔罗牌…",
    cover: "https://images.unsplash.com/photo-1512820790803-83ca734da794?w=300",
    wordCount: 4460000,
    lastChapter: "第七部 愚者 尾声",
    chapters: [
      {
        title: "第一章 绯红",
        content: `痛！\n\n好痛！\n\n头好痛！\n\n眩晕和疼痛交织在一起，如同尖锐的钝器一下下凿在太阳穴上。\n\n周明瑞挣扎着想要清醒，脑海深处却像是被塞入了一台轰鸣作响的蒸汽机，无数混杂的记忆碎片与嘈杂的呓语疯狂旋转冲撞。\n\n他努力撑开沉重的眼皮，映入眼帘的不是熟悉的现代卧室天花板，而是一片昏暗与淡黄。\n\n那是略显发霉的壁纸，上面印着繁复内敛的暗纹。一张铺着暗红天鹅绒桌布的胡桃木书桌静静立在窗前，上面摆着一盏铜质单臂煤气灯，灯罩内幽暗的火苗正微微摇曳。\n\n“这是哪里…？”\n\n周明瑞下意识伸出手按住剧烈抽痛的右侧太阳穴，掌心却触碰到了一片粘稠而温热的液体。\n\n他颤抖着收回手，就着微弱的煤气灯光芒看去——那是一滩猩红发黑的鲜血！\n\n在书桌正中央，正静静躺着一柄精巧的黄铜左轮手枪，枪口还残留着淡淡的硝烟气味。而在手枪旁边的日记本上，墨水未干的鲁恩文字清晰地写着：\n\n“所有人都会死，包括我。”`,
      },
      {
        title: "第二章 窥秘",
        content: `窗外是一轮巨大的圆月，正洒下宁静而诡异的绯红清辉。\n\n“克莱恩·莫雷蒂…廷根大学历史系毕业生…”\n\n脑海中狂暴涌出的记忆终于逐渐平复，周明瑞——或者说现在的克莱恩，按住依然隐隐作痛的额角，走向了立在墙角的穿衣镜。\n\n镜中倒映出一名身材中等、黑发深褐瞳孔的年轻男子，穿着略显陈旧的亚麻衬衫，右侧太阳穴处赫然有一个焦黑狰狞的弹孔！\n\n然而不可思议的是，那处致命的贯通伤正在以肉眼可见的速度悄然收口愈合，只留下一片粉红色的新生皮肤。\n\n“自杀？不，绝不是单纯的自杀…”克莱恩喃喃自语，目光落向了书桌抽屉深处露出的一本破旧羊皮笔记。\n\n那是记载着神秘学符号与未知仪式的笔记。而正是那个诡异的转运仪式，将他从地球的普通青年，带到了这个充满蒸汽、机械、魔药与旧日邪神低语的陌生世界！`,
      },
    ],
  },
  {
    _id: "builtin_frxx",
    title: "凡人修仙传",
    author: "忘语",
    cat: "仙侠",
    majorCate: "仙侠",
    latelyFollower: 218000,
    retentionRatio: "88.6%",
    shortIntro:
      "一个普通的山村穷小子，偶然之下，跨入到一个江湖小门派，虽然资质平庸，但依靠自身努力和合理算计最后修炼成仙的故事。",
    cover: "https://images.unsplash.com/photo-1516979187457-637abb4f9353?w=300",
    wordCount: 7700000,
    lastChapter: "第二千四百四十六章 飞升仙界（大结局）",
    chapters: [
      {
        title: "第一章 山边小村",
        content: `青牛镇五里沟，一座坐落在青山绿水之间的宁静小村庄。\n\n韩立坐在一棵老槐树下，手里摆弄着一根被削得光滑的木棍，黝黑消瘦的小脸上满是与年龄不符的沉稳。\n\n家里兄弟姐妹众多，日子过得捉襟见肘，一年到头难得吃上一顿带荤腥的白米饭。\n\n村头忽然传来了一阵清脆的驴铃声，在三叔的带领下，韩立背上简单的包袱，告别了满面愁容却强忍泪水的父母，踏上了前往七玄门考核的路程。\n\n“小立，到了七玄门，一定要听执事师兄的话。若是能成为内门弟子，你爹娘和你大哥小妹，下半辈子便不用愁了。”三叔拍着他的肩膀叮嘱。\n\n韩立重重点了点头，回望了一眼渐渐模糊的小山村，眼神中透出一丝坚定。谁能想到，这个貌不惊人的山村穷小子，未来竟会一步步踏上荆棘密布、残酷无情的修仙大道，名震三界！`,
      },
      {
        title: "第二章 掌天小瓶",
        content: `七玄门落霞峰，药园偏僻的草丛深处。\n\n韩立被墨大夫收为采药童子已有一年多。此时的他，正借着月光在崖壁旁寻找药草，脚下忽然踢到了一块坚硬冰凉的物事。\n\n他弯腰拂去泥土，发现那是一个只有巴掌大小的翠绿色小瓶。\n\n小瓶通体泛着温润的玉质光泽，表面铭刻着几道晦涩难懂的古怪花纹，拿在手中轻若无物。\n\n就在韩立想要拧开瓶盖的刹那，天空中的缕缕月光竟宛如受到了某种奇异的牵引，化作肉眼可见的点点银芒，缓缓朝小瓶汇聚而来…\n\n这枚神秘莫测的掌天瓶，即将彻底改变这个平凡少年的命运！`,
      },
    ],
  },
  {
    _id: "builtin_zt",
    title: "遮天",
    author: "辰东",
    cat: "仙侠",
    majorCate: "仙侠",
    latelyFollower: 263000,
    retentionRatio: "91.0%",
    shortIntro:
      "冰冷与黑暗并存的宇宙深处，九具庞大的龙尸拉着一口青铜古棺，亘古长存。登天路，踏歌行，弹指遮天！",
    cover: "https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=300",
    wordCount: 6300000,
    lastChapter: "第一千八百二十二章 遮天大结局",
    chapters: [
      {
        title: "第一章 星空中的九具龙尸",
        content: `生命是世间最伟大的奇迹。\n\n四方上下曰宇，往古来今曰宙。浩瀚无垠的宇宙深处，冰冷与黑暗是永恒的主题。\n\n国际空间站的观测屏幕前，几名宇航员的面庞瞬间被骇然所凝固。\n\n在枯寂漆黑的星空深处，九具庞大无比的庞然大物正无声无息地横渡而来！\n\n那是九具龙尸！每一具龙尸都长达百米，通体覆盖着青黑色的森然鳞片，犹如千锤百炼的精钢铸就，散发着浩瀚而冰冷的太古苍茫气息！\n\n更让人灵魂颤抖的是，在这九具龙尸的尾端，赫然绑缚着粗大的黑色神链，牢牢拉着一口长达二十米的青铜古棺！\n\n九龙拉棺，穿梭于无垠星海，正笔直朝着蔚蓝色的地球极速坠落！`,
      },
      {
        title: "第二章 泰山之巅",
        content: `泰山巍峨，拔地通天，自古便有“天下第一山”之美誉，历代帝皇登基封禅皆在此地。\n\n叶凡与一众大学同窗正漫步于玉皇顶，俯瞰千峰竞秀，谈笑风生。\n\n然而就在暮色渐沉、红日西坠的一瞬，整座巍峨泰山猛然剧烈震颤起来！\n\n天穹之上突然裂开一道巨大的漆黑裂隙，震耳欲聋的风雷呼啸中，九具庞大至极的神龙巨尸拖曳着斑驳苍凉的青铜巨棺，自域外星空轰然坠落于泰山之巅！\n\n巨石崩飞，五色祭坛光华冲天，命运的轮盘在此刻悄然转动，一段浩瀚磅礴的修真传奇拉开序幕！`,
      },
    ],
  },
  {
    _id: "builtin_xz",
    title: "雪中悍刀行",
    author: "烽火戏诸侯",
    cat: "武侠",
    majorCate: "武侠",
    latelyFollower: 278000,
    retentionRatio: "93.5%",
    shortIntro:
      "有个白狐儿脸，佩双刀绣冬春雷，要做那天下第一。湖底有老魁爱吃荤。缺门牙老仆背剑匣。山上有个骑青牛的年轻师叔祖，不敢下山。天下风云出我辈，一入江湖岁月催！",
    cover: "https://images.unsplash.com/photo-1534447677768-be436bb09401?w=300",
    wordCount: 4600000,
    lastChapter: "大结局 归去来兮",
    chapters: [
      {
        title: "第一章 小二上酒",
        content: `北凉边境，黄沙漫天的小镇酒肆外，走来了一主一仆。\n\n走在前面的年轻人一身破烂麻布衣衫，草鞋磨穿了底，满面风尘，腰间却附庸风雅地挂着一把劣质木刀。\n\n跟在后头的缺门牙老头更是寒碜，背着一个沉甸甸的破旧剑匣，牵着一匹瘦得皮包骨的老马，时不时贼眉鼠眼地四处打量。\n\n“小二，来两壶劣酒，切半斤熟牛肉！”年轻游侠儿一屁股坐在长凳上，拍下两枚铜钱，咧嘴一笑，露出一口洁白整齐的牙齿。\n\n谁能想到，眼前这个为了偷几个红薯被农户追打三里地的落魄小子，正是名震天下、三十万北凉铁骑的主人，北凉王徐骁的长子——徐凤年！\n\n游历六千里，踏尽人间苦。北凉世子，今日归来！`,
      },
    ],
  },
  {
    _id: "builtin_st",
    title: "三体",
    author: "刘慈欣",
    cat: "科幻",
    majorCate: "科幻",
    latelyFollower: 320000,
    retentionRatio: "95.0%",
    shortIntro:
      "文化大革命如火如荼进行之际，军方探寻外星文明的绝秘计划“红岸工程”取得了突破性进展。但无人料到，历经劫难的叶文洁向宇宙发出的信号，彻底改变了人类的命运…",
    cover: "https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=300",
    wordCount: 900000,
    lastChapter: "死神永生 终章",
    chapters: [
      {
        title: "第一章 疯狂年代",
        content: `中国，1967年。\n\n红卫兵的狂热呐喊撕裂了清华园的宁静，一场前所未有的暴风雨正席卷着大地的每一个角落。\n\n年轻的叶文洁站在狂热的人群外围，目光冰冷地看着自己的物理学家父亲叶哲泰被推上批判台。那些关于相对论与量子力学的真理，在狂热盲目的政治口号前显得如此苍白无力。\n\n当父亲在皮带与拳脚下永远停止呼吸的那一刻，叶文洁眼中的世界彻底失去了温度。\n\n她抬头望向灰蒙蒙的天空，心中那团关于对人类自身拯救的绝望火焰，正悄无声息地点燃…`,
      },
      {
        title: "第二章 红岸基地",
        content: `大兴安岭雷达峰顶，红岸基地。\n\n巨大的抛物面天线如同一只仰望苍穹的巨眼，时刻倾听着来自冷战对手乃至深空深处的电磁信号。\n\n叶文洁作为基地中罕见的理论物理专业技术人员，坐在庞大复杂的控制台前。\n\n一次偶然的太阳电磁辐射观测，让她发现了一个惊人的宇宙秘密——太阳不仅是一个巨大的能量源，更是一个绝妙的超级电波放大器！\n\n在这个寂静的黄昏，叶文洁悄悄调整了发射天线的仰角与输出功率，将那段决定人类文明生死存亡的短讯，借助太阳的超高频反射，推向了茫茫宇宙深处：\n\n“到这里来吧，我将帮助你们获得这个世界。我的文明已无力解决自己的问题，需要你们的力量介入…”`,
      },
    ],
  },
];

class BookstoreApi {
  constructor() {
    this.customProxy =
      localStorage.getItem(BOOKSTORE_PROXY_KEY) || DEFAULT_PROXY_URL;
  }

  setCustomProxy(proxyUrl) {
    this.customProxy = (proxyUrl || "").trim();
    if (this.customProxy) {
      localStorage.setItem(BOOKSTORE_PROXY_KEY, this.customProxy);
    } else {
      localStorage.removeItem(BOOKSTORE_PROXY_KEY);
    }
  }

  getCustomProxy() {
    return this.customProxy || DEFAULT_PROXY_URL;
  }

  wrapUrl(targetUrl) {
    const proxy = this.customProxy || DEFAULT_PROXY_URL;
    if (proxy) {
      const p = proxy.trim();
      if (p.includes("%s")) {
        return p.replace("%s", encodeURIComponent(targetUrl));
      }
      if (
        p.endsWith("?url=") ||
        p.endsWith("?quest=") ||
        p.endsWith("/?url=")
      ) {
        return `${p}${encodeURIComponent(targetUrl)}`;
      }
      const cleanBase = p.replace(/\/+$/, "");
      return `${cleanBase}/?url=${encodeURIComponent(targetUrl)}`;
    }
    return targetUrl;
  }

  async fetchWithTimeout(url, options = {}, timeoutMs = 4500) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      clearTimeout(id);
      return response;
    } catch (err) {
      clearTimeout(id);
      throw err;
    }
  }

  async fuzzySearch(query) {
    const trimmed = (query || "").trim();
    if (!trimmed) return [];

    let books = [];
    try {
      const target = `${DEFAULT_API_BASE}/book/fuzzy-search?query=${encodeURIComponent(trimmed)}`;
      const fetchUrl = this.wrapUrl(target);
      const res = await this.fetchWithTimeout(fetchUrl);
      if (res.ok) {
        const data = await res.json();
        if (data && Array.isArray(data.books) && data.books.length > 0) {
          books = data.books.map((b) => ({
            _id: b._id || b.id,
            title: b.title,
            author: b.author,
            cat: b.cat || b.majorCate || "网络文学",
            majorCate: b.majorCate || b.cat || "网络文学",
            shortIntro: b.shortIntro || b.intro || "暂无简介",
            cover: b.cover
              ? b.cover.startsWith("http")
                ? b.cover
                : `${STATIC_COVER_BASE}${b.cover}`
              : "",
            latelyFollower: b.latelyFollower || 1000,
            retentionRatio: b.retentionRatio || "75%",
            wordCount: b.wordCount || 0,
            lastChapter: b.lastChapter || "最新章节",
            isOnline: true,
          }));
        }
      }
    } catch (e) {
      console.warn("在线 API 搜索未响应，使用内置书库匹配", e.message);
    }

    const localMatches = BUILTIN_NOVELS.filter(
      (b) =>
        b.title.includes(trimmed) ||
        b.author.includes(trimmed) ||
        (b.cat && b.cat.includes(trimmed)) ||
        (b.shortIntro && b.shortIntro.includes(trimmed)),
    );

    const merged = [...books];
    for (const local of localMatches) {
      if (!merged.some((m) => m.title === local.title)) {
        merged.push(local);
      }
    }

    return merged;
  }

  async getHotwords() {
    try {
      const target = `${DEFAULT_API_BASE}/book/search-hotwords`;
      const res = await this.fetchWithTimeout(this.wrapUrl(target), {}, 2000);
      if (res.ok) {
        const data = await res.json();
        if (data && Array.isArray(data.hotWords) && data.hotWords.length > 0) {
          return data.hotWords
            .slice(0, 10)
            .map((item) => (typeof item === "string" ? item : item.word));
        }
      }
    } catch (e) {
      // fallback
    }
    return [
      "斗破苍穹",
      "诡秘之主",
      "凡人修仙传",
      "遮天",
      "雪中悍刀行",
      "三体",
      "剑来",
      "庆余年",
      "完美世界",
      "大奉打更人",
    ];
  }

  async getBookDetail(bookId) {
    const builtin = BUILTIN_NOVELS.find((b) => b._id === bookId);
    if (builtin) return builtin;

    try {
      const target = `${DEFAULT_API_BASE}/book/${bookId}`;
      const res = await this.fetchWithTimeout(this.wrapUrl(target));
      if (res.ok) {
        const data = await res.json();
        return {
          ...data,
          cover: data.cover
            ? data.cover.startsWith("http")
              ? data.cover
              : `${STATIC_COVER_BASE}${data.cover}`
            : "",
        };
      }
    } catch (e) {
      console.warn("获取在线小说详情失败", e);
    }
    return null;
  }

  async getChapters(bookId) {
    const builtin = BUILTIN_NOVELS.find((b) => b._id === bookId);
    if (builtin && builtin.chapters) {
      return builtin.chapters.map((ch, idx) => ({
        title: ch.title,
        link: `builtin_${bookId}_${idx}`,
      }));
    }

    try {
      const target = `${DEFAULT_API_BASE}/mix-atoc/${bookId}?view=chapters`;
      const res = await this.fetchWithTimeout(this.wrapUrl(target));
      if (res.ok) {
        const data = await res.json();
        if (data?.mixToc?.chapters) {
          return data.mixToc.chapters;
        }
      }
    } catch (e) {
      console.warn("获取章节列表失败", e);
    }
    return [];
  }

  async getChapterContent(bookId, link) {
    if (link.startsWith("builtin_")) {
      const parts = link.split("_");
      const idx = parseInt(parts.pop(), 10);
      const bId = parts.slice(1).join("_");
      const builtin = BUILTIN_NOVELS.find((b) => b._id === bId);
      if (builtin && builtin.chapters && builtin.chapters[idx]) {
        return builtin.chapters[idx].content;
      }
    }

    try {
      const target = `${DEFAULT_CHAPTER_BASE}/chapter/${encodeURIComponent(link)}`;
      const res = await this.fetchWithTimeout(this.wrapUrl(target));
      if (res.ok) {
        const data = await res.json();
        if (data?.chapter?.body) {
          return data.chapter.body;
        }
      }
    } catch (e) {
      console.warn("获取在线章节内容失败", e);
    }
    return "章节内容加载受阻或网络超时。可前往设置配置自定义 API 代理以获得全部章节。";
  }

  async assembleBookText(book) {
    const builtin = BUILTIN_NOVELS.find(
      (b) => b._id === book._id || b.title === book.title,
    );
    if (builtin && builtin.chapters) {
      let fullText = `${builtin.title}\n作者：${builtin.author}\n\n简介：\n${builtin.shortIntro}\n\n`;
      for (const ch of builtin.chapters) {
        fullText += `\n\n${ch.title}\n\n${ch.content}\n`;
      }
      return fullText;
    }

    const chapters = await this.getChapters(book._id);
    let fullText = `${book.title}\n作者：${book.author}\n\n简介：\n${book.shortIntro}\n\n`;
    if (!chapters.length) {
      fullText += `\n\n正文\n\n《${book.title}》暂无可用章节内容。建议在设置中配置有效代理。`;
      return fullText;
    }

    const previewCount = Math.min(chapters.length, 10);
    for (let i = 0; i < previewCount; i++) {
      const ch = chapters[i];
      const content = await this.getChapterContent(book._id, ch.link);
      fullText += `\n\n${ch.title}\n\n${content}\n`;
    }
    return fullText;
  }
}

class BookstoreController {
  constructor(options = {}) {
    this.api = new BookstoreApi();
    this.onAddBook = options.onAddBook || (async () => {});
    this.onOpenBook = options.onOpenBook || (async () => {});
    this.showToast = options.showToast || alert;
    this.currentModalBook = null;

    this.elements = {
      navTabs: document.getElementById("homeNavTabs"),
      tabShelf: document.getElementById("tabShelf"),
      tabStore: document.getElementById("tabStore"),
      shelfSection: document.getElementById("welcome"),
      storeSection: document.getElementById("bookstore"),
      searchInput: document.getElementById("storeSearchInput"),
      searchButton: document.getElementById("storeSearchButton"),
      clearButton: document.getElementById("storeClearButton"),
      hotTags: document.getElementById("storeHotTags"),
      categoryPills: document.getElementById("storeCategoryPills"),
      bookList: document.getElementById("storeBookList"),
      loadingIndicator: document.getElementById("storeLoading"),
      emptyState: document.getElementById("storeEmpty"),
      detailModal: document.getElementById("bookDetailModal"),
      modalCover: document.getElementById("modalBookCover"),
      modalTitle: document.getElementById("modalBookTitle"),
      modalAuthor: document.getElementById("modalBookAuthor"),
      modalCategory: document.getElementById("modalBookCategory"),
      modalFollower: document.getElementById("modalBookFollower"),
      modalIntro: document.getElementById("modalBookIntro"),
      modalLastChapter: document.getElementById("modalBookLastChapter"),
      btnAddShelf: document.getElementById("modalBtnAddShelf"),
      btnReadNow: document.getElementById("modalBtnReadNow"),
      btnCloseModal: document.getElementById("modalBtnClose"),
      proxyInput: document.getElementById("bookstoreProxyInput"),
      saveProxyBtn: document.getElementById("saveProxyButton"),
    };
  }

  init() {
    this.bindEvents();
    this.loadHotwords();
    this.initProxySettings();
    this.performSearch("斗破");
  }

  bindEvents() {
    this.elements.tabShelf?.addEventListener("click", () =>
      this.switchTab("shelf"),
    );
    this.elements.tabStore?.addEventListener("click", () =>
      this.switchTab("store"),
    );

    const handleSearch = () => {
      const val = this.elements.searchInput.value.trim();
      if (val) this.performSearch(val);
    };

    this.elements.searchButton?.addEventListener("click", handleSearch);
    this.elements.searchInput?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") handleSearch();
    });

    this.elements.clearButton?.addEventListener("click", () => {
      this.elements.searchInput.value = "";
      this.elements.clearButton.hidden = true;
      this.elements.searchInput.focus();
    });

    this.elements.searchInput?.addEventListener("input", () => {
      this.elements.clearButton.hidden = !this.elements.searchInput.value;
    });

    this.elements.categoryPills?.addEventListener("click", (e) => {
      const btn = e.target.closest("button");
      if (!btn) return;
      this.elements.categoryPills
        .querySelectorAll("button")
        .forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      const cat = btn.dataset.cat;
      if (cat === "all") {
        this.performSearch("修仙");
      } else {
        this.performSearch(cat);
      }
    });

    this.elements.btnCloseModal?.addEventListener("click", () =>
      this.closeDetailModal(),
    );
    this.elements.detailModal?.addEventListener("click", (e) => {
      if (e.target === this.elements.detailModal) this.closeDetailModal();
    });

    this.elements.btnAddShelf?.addEventListener("click", () =>
      this.handleAddShelf(),
    );
    this.elements.btnReadNow?.addEventListener("click", () =>
      this.handleReadNow(),
    );

    this.elements.saveProxyBtn?.addEventListener("click", () => {
      const val = this.elements.proxyInput.value.trim();
      this.api.setCustomProxy(val);
      this.showToast(val ? "代理地址已保存" : "已清除自定义代理");
    });
  }

  initProxySettings() {
    if (this.elements.proxyInput) {
      this.elements.proxyInput.value = this.api.getCustomProxy();
    }
  }

  switchTab(tab) {
    const isShelf = tab === "shelf";
    this.elements.tabShelf.classList.toggle("active", isShelf);
    this.elements.tabStore.classList.toggle("active", !isShelf);
    this.elements.shelfSection.hidden = !isShelf;
    this.elements.storeSection.hidden = isShelf;
  }

  async loadHotwords() {
    const words = await this.api.getHotwords();
    if (!this.elements.hotTags) return;

    this.elements.hotTags.replaceChildren(
      ...words.map((word) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "hot-tag-pill";
        btn.textContent = word;
        btn.addEventListener("click", () => {
          this.elements.searchInput.value = word;
          this.elements.clearButton.hidden = false;
          this.performSearch(word);
        });
        return btn;
      }),
    );
  }

  async performSearch(keyword) {
    if (this.elements.loadingIndicator)
      this.elements.loadingIndicator.hidden = false;
    if (this.elements.emptyState) this.elements.emptyState.hidden = true;
    if (this.elements.bookList) this.elements.bookList.replaceChildren();

    try {
      const results = await this.api.fuzzySearch(keyword);
      if (this.elements.loadingIndicator)
        this.elements.loadingIndicator.hidden = true;

      if (!results || results.length === 0) {
        if (this.elements.emptyState) this.elements.emptyState.hidden = false;
        return;
      }

      this.renderBookCards(results);
    } catch (e) {
      console.error(e);
      if (this.elements.loadingIndicator)
        this.elements.loadingIndicator.hidden = true;
      if (this.elements.emptyState) this.elements.emptyState.hidden = false;
    }
  }

  renderBookCards(books) {
    this.elements.bookList.replaceChildren(
      ...books.map((book) => {
        const card = document.createElement("article");
        card.className = "store-book-card";

        const coverBox = document.createElement("div");
        coverBox.className = "book-cover-box";
        if (book.cover) {
          const img = document.createElement("img");
          img.src = book.cover;
          img.alt = book.title;
          img.loading = "lazy";
          img.onerror = () => {
            coverBox.innerHTML = `<div class="fallback-cover"><span>${escapeHtml(book.title.slice(0, 4))}</span></div>`;
          };
          coverBox.appendChild(img);
        } else {
          coverBox.innerHTML = `<div class="fallback-cover"><span>${escapeHtml(book.title.slice(0, 4))}</span></div>`;
        }

        const info = document.createElement("div");
        info.className = "book-info";

        const title = document.createElement("h3");
        title.className = "book-title";
        title.textContent = book.title;

        const meta = document.createElement("div");
        meta.className = "book-meta";
        meta.innerHTML = `
          <span class="meta-author">${escapeHtml(book.author || "佚名")}</span>
          <span class="meta-tag">${escapeHtml(book.cat || book.majorCate || "网络")}</span>
          <span class="meta-pop">${formatFollowers(book.latelyFollower)} 人气</span>
        `;

        const desc = document.createElement("p");
        desc.className = "book-desc";
        desc.textContent = book.shortIntro || "暂无书籍简介";

        info.append(title, meta, desc);
        card.append(coverBox, info);

        card.addEventListener("click", () => this.openDetailModal(book));
        return card;
      }),
    );
  }

  openDetailModal(book) {
    this.currentModalBook = book;
    const m = this.elements;

    m.modalTitle.textContent = book.title;
    m.modalAuthor.textContent = `作者：${book.author || "佚名"}`;
    m.modalCategory.textContent = `分类：${book.cat || book.majorCate || "综合"}`;
    m.modalFollower.textContent = `人气：${formatFollowers(book.latelyFollower)} | 留存率：${book.retentionRatio || "80%"}`;
    m.modalIntro.textContent = book.shortIntro || "暂无详细简介。";
    m.modalLastChapter.textContent = book.lastChapter
      ? `最新章节：${book.lastChapter}`
      : "";

    if (book.cover) {
      m.modalCover.src = book.cover;
      m.modalCover.hidden = false;
      m.modalCover.onerror = () => {
        m.modalCover.hidden = true;
      };
    } else {
      m.modalCover.hidden = true;
    }

    m.detailModal.classList.add("open");
    m.detailModal.setAttribute("aria-hidden", "false");
  }

  closeDetailModal() {
    this.elements.detailModal.classList.remove("open");
    this.elements.detailModal.setAttribute("aria-hidden", "true");
    this.currentModalBook = null;
  }

  async handleAddShelf() {
    if (!this.currentModalBook) return;
    const book = this.currentModalBook;
    const btn = this.elements.btnAddShelf;
    btn.disabled = true;
    btn.textContent = "加入中…";

    try {
      const text = await this.api.assembleBookText(book);
      await this.onAddBook({
        id: `store_${book._id || Date.now()}`,
        title: book.title,
        text: text,
      });
      this.showToast(`《${book.title}》已成功加入书架`);
      this.closeDetailModal();
    } catch (e) {
      console.error(e);
      this.showToast("加入书架失败：" + e.message);
    } finally {
      btn.disabled = false;
      btn.textContent = "＋ 加入书架";
    }
  }

  async handleReadNow() {
    if (!this.currentModalBook) return;
    const book = this.currentModalBook;
    const btn = this.elements.btnReadNow;
    btn.disabled = true;
    btn.textContent = "准备中…";

    try {
      const text = await this.api.assembleBookText(book);
      const bookRecord = {
        id: `store_${book._id || Date.now()}`,
        title: book.title,
        text: text,
      };
      await this.onAddBook(bookRecord);
      this.closeDetailModal();
      await this.onOpenBook(bookRecord);
    } catch (e) {
      console.error(e);
      this.showToast("打开阅读失败：" + e.message);
    } finally {
      btn.disabled = false;
      btn.textContent = "立即阅读";
    }
  }
}

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatFollowers(num) {
  if (!num) return "1000";
  if (num > 10000) return (num / 10000).toFixed(1) + "万";
  return String(num);
}

window.BookstoreController = BookstoreController;
window.BookstoreApi = BookstoreApi;

function setupQuickTabs() {
  const tabShelf = document.getElementById("tabShelf");
  const tabStore = document.getElementById("tabStore");
  const welcome = document.getElementById("welcome");
  const bookstore = document.getElementById("bookstore");

  if (!tabShelf || !tabStore || !welcome || !bookstore) return;

  tabShelf.addEventListener("click", () => {
    tabShelf.classList.add("active");
    tabStore.classList.remove("active");
    welcome.hidden = false;
    bookstore.hidden = true;
  });

  tabStore.addEventListener("click", () => {
    tabStore.classList.add("active");
    tabShelf.classList.remove("active");
    welcome.hidden = true;
    bookstore.hidden = false;
  });

  // 初始化 bookstore controller（需要在 DOM 加载完成后执行）
  if (!window.bookstoreCtrl && window.BookstoreController) {
    window.bookstoreCtrl = new window.BookstoreController({
      onAddBook: (b) =>
        window.addBookToShelf ? window.addBookToShelf(b) : null,
      onOpenBook: (b) => (window.openBook ? window.openBook(b) : null),
      showToast: (msg) => {
        const toast = document.getElementById("toast");
        if (toast) {
          toast.textContent = msg;
          toast.classList.add("show");
          setTimeout(() => toast.classList.remove("show"), 1800);
        }
      },
    });
    window.bookstoreCtrl.init();
  }
}

// 等待 DOM 加载完成后执行
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", setupQuickTabs);
} else {
  setupQuickTabs();
}
