import { SocialPlatform, SocialPostStatus } from "@prisma/client";
import { getAppConfigValues, type SetupConfigKey } from "@/lib/app-config";
import { prisma } from "@/lib/prisma";

const credentialKeys: Record<SocialPlatform, SetupConfigKey[]> = {
  INSTAGRAM: ["INSTAGRAM_GRAPH_TOKEN"],
  FACEBOOK: ["FACEBOOK_PAGE_TOKEN"],
  TIKTOK: ["TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET"],
  YOUTUBE_SHORTS: ["YOUTUBE_CLIENT_ID", "YOUTUBE_CLIENT_SECRET"]
};

export async function missingSocialCredentials(platforms: SocialPlatform[]) {
  const keys = Array.from(new Set(platforms.flatMap((platform) => credentialKeys[platform])));
  const config = await getAppConfigValues(keys);
  return platforms.flatMap((platform) => credentialKeys[platform].filter((key) => !config[key]).map((key) => `${platform}:${key}`));
}

export function generateContentIdeas(context: {
  type: string;
  subject: string;
  defaultHashtags: string[];
}) {
  const subject = context.subject || "this week's bake";
  const baseTags = context.defaultHashtags.length ? context.defaultHashtags : ["microbakery", "freshbread", "smallbatch"];
  return {
    captions: [
      `${subject} is headed for the oven. Ordering windows are short, so save your spot while the menu is live.`,
      `A small-batch note from the kitchen: ${subject}. Baked with care, packed for pickup and delivery day.`,
      `Fresh menu energy: ${subject}. Tell me what you are eyeing before the window closes.`
    ],
    hashtags: baseTags.map((tag) => (tag.startsWith("#") ? tag : `#${tag}`)),
    videoScript: `Shot 1: open on the dough or finished bake. Shot 2: show texture, filling, or crumb. Shot 3: add text overlay for ${subject}. Shot 4: close with ordering date and pickup/delivery reminder.`,
    carouselOutline: [
      "Slide 1: hero product photo and menu title",
      "Slide 2: ingredients or flavor notes",
      "Slide 3: order window details",
      "Slide 4: pickup or delivery instructions",
      "Slide 5: reminder to save/share"
    ],
    newsletterCopy: `Hi bakery friends,\n\nThe next menu is built around ${subject}. Orders are available during the current order window, with limited quantities and pickup or local delivery options.\n\nThank you for supporting a tiny bakery with a very warm oven.`
  };
}

export async function createAutomatedDraft(input: {
  title: string;
  trigger: string;
  productId?: string;
  popupEventId?: string;
  orderWindowId?: string;
}) {
  const settings = await prisma.adminSettings.findFirst();
  const generated = generateContentIdeas({
    type: input.trigger,
    subject: input.title,
    defaultHashtags: settings?.defaultHashtags ?? []
  });

  return prisma.socialPost.create({
    data: {
      title: `${input.trigger}: ${input.title}`,
      caption: generated.captions[0],
      hashtags: generated.hashtags,
      platforms: ["INSTAGRAM", "FACEBOOK"],
      status: "DRAFT",
      productId: input.productId,
      popupEventId: input.popupEventId,
      orderWindowId: input.orderWindowId
    }
  });
}

export async function attemptPublish(postId: string) {
  const post = await prisma.socialPost.findUnique({ where: { id: postId } });
  if (!post) throw new Error("Post not found");
  if (!["APPROVED", "SCHEDULED"].includes(post.status)) {
    throw new Error("Only approved or scheduled posts can be published.");
  }

  const missing = await missingSocialCredentials(post.platforms);
  if (missing.length) {
    return prisma.socialPost.update({
      where: { id: post.id },
      data: {
        status: post.status as SocialPostStatus,
        failureReason: `Publishing paused. Missing credentials: ${missing.join(", ")}`
      }
    });
  }

  // TODO: Replace this guard with real Instagram Graph API, Facebook Pages API,
  // TikTok API, and YouTube Data API publishing calls once credentials,
  // media upload flows, and account permissions are configured. Do not mark a
  // post as POSTED until the remote API confirms publication.
  return prisma.socialPost.update({
    where: { id: post.id },
    data: {
      status: post.status,
      failureReason: "Automatic publishing is not connected. Publish approved copy in the platform directly. Add real API calls before enabling public posting."
    }
  });
}
