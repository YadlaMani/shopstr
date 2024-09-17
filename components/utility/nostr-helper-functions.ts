import CryptoJS from "crypto-js";
import {
  finalizeEvent,
  nip04,
  nip19,
  nip44,
  nip98,
  SimplePool,
} from "nostr-tools";
import axios from "axios";
import { NostrEvent } from "@/utils/types/types";
import { Proof } from "@cashu/cashu-ts";
import { ProductFormValues } from "@/pages/api/nostr/post-event";
import { DeleteEvent } from "@/pages/api/nostr/crud-service";

function containsRelay(relays: string[], relay: string): boolean {
  return relays.some((r) => r.includes(relay));
}

export async function PostListing(
  values: ProductFormValues,
  passphrase: string,
) {
  const { signInMethod, userPubkey, relays, writeRelays } =
    getLocalStorageData();
  const summary = values.find(([key]) => key === "summary")?.[1] || "";

  const dValue = values.find(([key]) => key === "d")?.[1] || undefined;

  const created_at = Math.floor(Date.now() / 1000);
  // Add "published_at" key
  const updatedValues = [...values, ["published_at", String(created_at)]];

  if (signInMethod === "extension") {
    const event = {
      created_at: created_at,
      kind: 30402,
      // kind: 30018,
      tags: updatedValues,
      content: summary,
    };

    const recEvent = {
      kind: 31989,
      tags: [
        ["d", "30402"],
        [
          "a",
          "31990:" + userPubkey + ":" + dValue,
          "wss://relay.damus.io",
          "web",
        ],
      ],
      content: "",
      created_at: Math.floor(Date.now() / 1000),
    };

    const handlerEvent = {
      kind: 31990,
      tags: [
        ["d", dValue],
        ["k", "30402"],
        ["web", "https://shopstr.store/<bech-32>", "npub"],
      ],
      content: "",
      created_at: Math.floor(Date.now() / 1000),
    };

    const signedEvent = await window.nostr.signEvent(event);
    const signedRecEvent = await window.nostr.signEvent(recEvent);
    const signedHandlerEvent = await window.nostr.signEvent(handlerEvent);

    const pool = new SimplePool();

    const allWriteRelays = [...writeRelays, ...relays];
    const blastrRelay = "wss://nostr.mutinywallet.com";
    if (!containsRelay(allWriteRelays, blastrRelay)) {
      allWriteRelays.push(blastrRelay);
    }

    await Promise.any(pool.publish(allWriteRelays, signedEvent));
    await Promise.any(pool.publish(allWriteRelays, signedRecEvent));
    await Promise.any(pool.publish(allWriteRelays, signedHandlerEvent));
    return signedEvent;
  } else {
    const allWriteRelays = [...writeRelays, ...relays];
    const blastrRelay = "wss://nostr.mutinywallet.com";
    if (!containsRelay(allWriteRelays, blastrRelay)) {
      allWriteRelays.push(blastrRelay);
    }
    const res = await axios({
      method: "POST",
      url: "/api/nostr/post-event",
      headers: {
        "Content-Type": "application/json",
      },
      data: {
        pubkey: userPubkey,
        privkey: getPrivKeyWithPassphrase(passphrase),
        created_at: created_at,
        kind: 30402,
        // kind: 30018,
        tags: updatedValues,
        content: summary,
        relays: allWriteRelays,
      },
    });
    return {
      id: res.data.id,
      pubkey: userPubkey,
      created_at: created_at,
      kind: 30402,
      tags: updatedValues,
      content: summary,
    };
  }
}

interface EncryptedMessageEvent {
  pubkey: string;
  created_at: number;
  content: string;
  kind: number;
  tags: string[][];
}

export async function constructEncryptedMessageEvent(
  senderPubkey: string,
  message: string,
  recipientPubkey: string,
  passphrase?: string,
): Promise<EncryptedMessageEvent> {
  let encryptedContent = "";
  let signInMethod = getLocalStorageData().signInMethod;
  if (signInMethod === "extension") {
    encryptedContent = await window.nostr.nip04.encrypt(
      recipientPubkey,
      message,
    );
  } else if (signInMethod === "nsec") {
    if (!passphrase) {
      throw new Error("Passphrase is required");
    }
    let senderPrivkey = getPrivKeyWithPassphrase(passphrase) as Uint8Array;
    encryptedContent = await nip04.encrypt(
      senderPrivkey,
      recipientPubkey,
      message,
    );
  }
  let encryptedMessageEvent = {
    pubkey: senderPubkey,
    created_at: Math.floor(Date.now() / 1000),
    content: encryptedContent,
    kind: 4,
    tags: [["p", recipientPubkey]],
  };
  return encryptedMessageEvent;
}

export async function sendEncryptedMessage(
  encryptedMessageEvent: EncryptedMessageEvent,
  passphrase?: string,
): Promise<NostrEvent> {
  const { signInMethod, relays, writeRelays } = getLocalStorageData();
  let signedEvent;
  if (signInMethod === "extension") {
    signedEvent = await window.nostr.signEvent(encryptedMessageEvent);
  } else {
    if (!passphrase) throw new Error("Passphrase is required");
    let senderPrivkey = getPrivKeyWithPassphrase(passphrase) as Uint8Array;
    signedEvent = finalizeEvent(encryptedMessageEvent, senderPrivkey);
  }
  const pool = new SimplePool();
  const allWriteRelays = [...writeRelays, ...relays];
  const blastrRelay = "wss://nostr.mutinywallet.com";
  if (!containsRelay(allWriteRelays, blastrRelay)) {
    allWriteRelays.push(blastrRelay);
  }
  await Promise.any(pool.publish(allWriteRelays, signedEvent));
  return signedEvent;
}

export async function publishWalletEvent(passphrase?: string, dTag?: string) {
  try {
    const {
      signInMethod,
      relays,
      writeRelays,
      cashuWalletRelays,
      mints,
      tokens,
      userPubkey,
    } = getLocalStorageData();

    let mintTagsSet = new Set<string>();
    let relayTagsSet = new Set<string>();

    let walletMints = [];
    let walletRelays = [];

    let balance = tokens.reduce(
      (acc, current: Proof) => acc + current.amount,
      0,
    );
    const allWriteRelays = [...relays, ...writeRelays];
    cashuWalletRelays.forEach((relay) => relayTagsSet.add(relay));
    walletRelays = Array.from(relayTagsSet);
    const relayTags =
      cashuWalletRelays.length != 0
        ? walletRelays.map((relay) => ["relay", relay])
        : allWriteRelays.map((relay) => ["relay", relay]);
    mints.forEach((mint) => mintTagsSet.add(mint));
    walletMints = Array.from(mintTagsSet);
    const mintTags = walletMints.map((mint) => ["mint", mint]);
    const walletContent = [["balance", String(balance), "sat"]];
    let signedEvent;
    if (signInMethod === "extension") {
      const cashuWalletEvent = {
        kind: 37375,
        tags: [
          ["d", dTag ? dTag : "my-shopstr-wallet"],
          ...mintTags,
          ["name", "Shopstr Wallet"],
          ["unit", "sat"],
          ["description", "a wallet for shopstr sales and purchases"],
          ...relayTags,
        ],
        content: await window.nostr.nip44.encrypt(
          userPubkey,
          JSON.stringify(walletContent),
        ),
        created_at: Math.floor(Date.now() / 1000),
      };
      signedEvent = await window.nostr.signEvent(cashuWalletEvent);
    } else {
      if (!passphrase) throw new Error("Passphrase is required");
      let senderPrivkey = getPrivKeyWithPassphrase(passphrase) as Uint8Array;
      const conversationKey = nip44.getConversationKey(
        senderPrivkey,
        userPubkey,
      );
      const cashuWalletEvent = {
        kind: 37375,
        tags: [
          ["d", dTag ? dTag : "my-shopstr-wallet"],
          ...mintTags,
          ["name", "Shopstr Wallet"],
          ["unit", "sat"],
          ["description", "a wallet for shopstr sales and purchases"],
          ...relayTags,
        ],
        content: nip44.encrypt(JSON.stringify(walletContent), conversationKey),
        created_at: Math.floor(Date.now() / 1000),
      };
      signedEvent = finalizeEvent(cashuWalletEvent, senderPrivkey);
    }
    const pool = new SimplePool();
    await Promise.any(pool.publish(allWriteRelays, signedEvent));
  } catch (e: any) {
    alert("Failed to send event: " + e.message);
    return { error: e };
  }
}

function isProofArray(proof: any): proof is Proof[] {
  return (
    Array.isArray(proof) &&
    proof.every((item) => typeof item === "object" && "id" in item)
  );
}

function isProofArrayArray(proof: any): proof is Proof[][] {
  return Array.isArray(proof) && proof.every((item) => isProofArray(item));
}

export async function publishProofEvent(
  mint: string,
  proof: Proof[] | Proof[][],
  direction: "in" | "out",
  passphrase?: string,
  dTag?: string,
) {
  try {
    const { userPubkey, signInMethod, relays, writeRelays, cashuWalletRelays } =
      getLocalStorageData();
    const allWriteRelays = [...relays, ...writeRelays];

    const encoder = new TextEncoder();
    const dataEncoded = encoder.encode("shopstr" + userPubkey);
    const hashBuffer = await crypto.subtle.digest("SHA-256", dataEncoded);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    if (isProofArrayArray(proof)) {
      proof.forEach(async (proofArray) => {
        const tokenArray = { mint: mint, proofs: proofArray };

        const amount = tokenArray.proofs
          .reduce((acc, token: Proof) => acc + token.amount, 0)
          .toString();

        let dTagContent = dTag ? ":" + dTag : hashHex;

        let signedEvent;
        if (signInMethod === "extension") {
          const cashuProofEvent = {
            kind: 7375,
            tags: [["a", "37375:" + userPubkey + dTagContent]],
            content: await window.nostr.nip44.encrypt(
              userPubkey,
              JSON.stringify(tokenArray),
            ),
            created_at: Math.floor(Date.now() / 1000),
          };
          signedEvent = await window.nostr.signEvent(cashuProofEvent);
        } else {
          if (!passphrase) throw new Error("Passphrase is required");
          let senderPrivkey = getPrivKeyWithPassphrase(
            passphrase,
          ) as Uint8Array;
          const conversationKey = nip44.getConversationKey(
            senderPrivkey,
            userPubkey,
          );

          const cashuProofEvent = {
            kind: 7375,
            tags: [["a", "37375:" + userPubkey + dTagContent]],
            content: nip44.encrypt(JSON.stringify(tokenArray), conversationKey),
            created_at: Math.floor(Date.now() / 1000),
          };
          signedEvent = finalizeEvent(cashuProofEvent, senderPrivkey);
        }

        const pool = new SimplePool();
        await Promise.any(
          pool.publish(
            cashuWalletRelays.length != 0 ? cashuWalletRelays : allWriteRelays,
            signedEvent,
          ),
        );

        await publishSpendingHistoryEvent(
          direction,
          amount,
          [signedEvent.id],
          passphrase,
        );
      });
    } else {
      const tokenArray = { mint: mint, proofs: proof };

      const amount = tokenArray.proofs
        .reduce((acc, token: Proof) => acc + token.amount, 0)
        .toString();

      let dTagContent = dTag ? ":" + dTag : hashHex;

      let signedEvent;
      if (signInMethod === "extension") {
        const cashuProofEvent = {
          kind: 7375,
          tags: [["a", "37375:" + userPubkey + dTagContent]],
          content: await window.nostr.nip44.encrypt(
            userPubkey,
            JSON.stringify(tokenArray),
          ),
          created_at: Math.floor(Date.now() / 1000),
        };
        signedEvent = await window.nostr.signEvent(cashuProofEvent);
      } else {
        if (!passphrase) throw new Error("Passphrase is required");
        let senderPrivkey = getPrivKeyWithPassphrase(passphrase) as Uint8Array;
        const conversationKey = nip44.getConversationKey(
          senderPrivkey,
          userPubkey,
        );

        const cashuProofEvent = {
          kind: 7375,
          tags: [["a", "37375:" + userPubkey + dTagContent]],
          content: nip44.encrypt(JSON.stringify(tokenArray), conversationKey),
          created_at: Math.floor(Date.now() / 1000),
        };
        signedEvent = finalizeEvent(cashuProofEvent, senderPrivkey);
      }

      const pool = new SimplePool();
      await Promise.any(
        pool.publish(
          cashuWalletRelays.length != 0 ? cashuWalletRelays : allWriteRelays,
          signedEvent,
        ),
      );

      await publishSpendingHistoryEvent(
        direction,
        amount,
        [signedEvent.id],
        passphrase,
      );
    }
  } catch (e: any) {
    alert("Failed to send event: " + e.message);
    return { error: e };
  }
}

export async function publishSpendingHistoryEvent(
  direction: string,
  amount: string,
  eventIds: string[],
  passphrase?: string,
  dTag?: string,
) {
  try {
    const { userPubkey, signInMethod, relays, writeRelays, cashuWalletRelays } =
      getLocalStorageData();
    const allWriteRelays = [...relays, ...writeRelays];
    const eventContent = [
      ["direction", direction],
      ["amount", amount, "sats"],
    ];

    eventIds.forEach((eventId) => {
      eventContent.push([
        "e",
        eventId,
        cashuWalletRelays.length != 0
          ? cashuWalletRelays[0]
          : allWriteRelays[0],
        direction === "in" ? "created" : "destroyed",
      ]);
    });

    const encoder = new TextEncoder();
    const dataEncoded = encoder.encode("shopstr" + userPubkey);
    const hashBuffer = await crypto.subtle.digest("SHA-256", dataEncoded);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    let dTagContent = dTag ? ":" + dTag : hashHex;

    let signedEvent;
    if (signInMethod === "extension") {
      const cashuSpendingHistoryEvent = {
        kind: 7376,
        tags: [["a", "37375:" + userPubkey + dTagContent]],
        content: await window.nostr.nip44.encrypt(
          userPubkey,
          JSON.stringify(eventContent),
        ),
        created_at: Math.floor(Date.now() / 1000),
      };
      signedEvent = await window.nostr.signEvent(cashuSpendingHistoryEvent);
    } else {
      if (!passphrase) throw new Error("Passphrase is required");
      let senderPrivkey = getPrivKeyWithPassphrase(passphrase) as Uint8Array;
      const conversationKey = nip44.getConversationKey(
        senderPrivkey,
        userPubkey,
      );

      const cashuSpendingHistoryEvent = {
        kind: 7376,
        tags: [["a", "37375:" + userPubkey + dTagContent]],
        content: nip44.encrypt(JSON.stringify(eventContent), conversationKey),
        created_at: Math.floor(Date.now() / 1000),
      };
      signedEvent = finalizeEvent(cashuSpendingHistoryEvent, senderPrivkey);
    }

    const pool = new SimplePool();
    await Promise.any(
      pool.publish(
        cashuWalletRelays.length != 0 ? cashuWalletRelays : allWriteRelays,
        signedEvent,
      ),
    );

    if (direction === "out") {
      await DeleteEvent(eventIds, passphrase);
    }
  } catch (e: any) {
    alert("Failed to send event: " + e.message);
    return { error: e };
  }
}

export async function finalizeAndSendNostrEvent(
  nostrEvent: NostrEvent,
  passphrase?: string,
) {
  try {
    const { signInMethod, relays, writeRelays } = getLocalStorageData();
    let signedEvent;
    if (signInMethod === "extension") {
      signedEvent = await window.nostr.signEvent(nostrEvent);
    } else {
      if (!passphrase) throw new Error("Passphrase is required");
      let senderPrivkey = getPrivKeyWithPassphrase(passphrase) as Uint8Array;
      signedEvent = finalizeEvent(nostrEvent, senderPrivkey);
    }
    const pool = new SimplePool();
    const allWriteRelays = [...writeRelays, ...relays];
    const blastrRelay = "wss://nostr.mutinywallet.com";
    if (!containsRelay(allWriteRelays, blastrRelay)) {
      allWriteRelays.push(blastrRelay);
    }
    await Promise.any(pool.publish(allWriteRelays, signedEvent));
  } catch (e: any) {
    alert("Failed to send event: " + e.message);
    return { error: e };
  }
}

export type NostrBuildResponse = {
  status: "success" | "error";
  message: string;
  data: {
    input_name: "APIv2";
    name: string;
    url: string;
    thumbnail: string;
    responsive: {
      "240p": string;
      "360p": string;
      "480p": string;
      "720p": string;
      "1080p": string;
    };
    blurhash: string;
    sha256: string;
    type: "picture" | "video";
    mime: string;
    size: number;
    metadata: Record<string, string>;
    dimensions: {
      width: number;
      height: number;
    };
  }[];
};

export type DraftNostrEvent = Omit<NostrEvent, "pubkey" | "id" | "sig">;

export async function nostrBuildUploadImages(
  images: File[],
  sign?: (draft: DraftNostrEvent) => Promise<NostrEvent>,
) {
  if (images.some((img) => !img.type.includes("image")))
    throw new Error("Only images are supported");

  const url = "https://nostr.build/api/v2/upload/files";

  const payload = new FormData();
  images.forEach((image) => {
    payload.append("file[]", image);
  });

  const headers: HeadersInit = {};
  if (sign) {
    const token = await nip98.getToken(url, "POST", sign, true);
    headers.Authorization = token;
  }

  const response = await fetch(url, {
    body: payload,
    method: "POST",
    headers,
  }).then((res) => res.json() as Promise<NostrBuildResponse>);

  return response.data;
}

/***** HELPER FUNCTIONS *****/

// function to validate public and private keys
export function validateNPubKey(publicKey: string) {
  const validPubKey = /^npub[a-zA-Z0-9]{59}$/;
  return publicKey.match(validPubKey) !== null;
}
export function validateNSecKey(privateKey: string) {
  const validPrivKey = /^nsec[a-zA-Z0-9]{59}$/;
  return privateKey.match(validPrivKey) !== null;
}

export function validPassphrase(passphrase: string) {
  try {
    let nsec = getNsecWithPassphrase(passphrase);
    if (!nsec) return false; // invalid passphrase
  } catch (e) {
    return false; // invalid passphrase
  }
  return true; // valid passphrase
}

export function getNsecWithPassphrase(passphrase: string) {
  if (!passphrase) return undefined;
  const { encryptedPrivateKey } = getLocalStorageData();
  let nsec = CryptoJS.AES.decrypt(
    encryptedPrivateKey as string,
    passphrase,
  ).toString(CryptoJS.enc.Utf8);
  // returns undefined or "" thanks to the toString method
  return nsec;
}

export function getPrivKeyWithPassphrase(passphrase: string) {
  const nsec = getNsecWithPassphrase(passphrase);
  if (!nsec) return undefined;
  let { data } = nip19.decode(nsec);
  return data;
}

const LOCALSTORAGECONSTANTS = {
  signInMethod: "signInMethod",
  userNPub: "userNPub",
  userPubkey: "userPubkey",
  encryptedPrivateKey: "encryptedPrivateKey",
  relays: "relays",
  readRelays: "readRelays",
  writeRelays: "writeRelays",
  cashuWalletRelays: "cashuWalletRelays",
  mints: "mints",
  tokens: "tokens",
  history: "history",
  wot: "wot",
};

export const setLocalStorageDataOnSignIn = ({
  signInMethod,
  pubkey,
  encryptedPrivateKey,
  relays,
  readRelays,
  writeRelays,
  cashuWalletRelays,
  mints,
  wot,
}: {
  signInMethod: string;
  pubkey: string;
  encryptedPrivateKey?: string;
  relays?: string[];
  readRelays?: string[];
  cashuWalletRelays?: string[];
  writeRelays?: string[];
  mints?: string[];
  wot?: number;
}) => {
  localStorage.setItem(LOCALSTORAGECONSTANTS.signInMethod, signInMethod);
  localStorage.setItem(
    LOCALSTORAGECONSTANTS.userNPub,
    nip19.npubEncode(pubkey),
  );
  localStorage.setItem(LOCALSTORAGECONSTANTS.userPubkey, pubkey);
  if (encryptedPrivateKey) {
    localStorage.setItem(
      LOCALSTORAGECONSTANTS.encryptedPrivateKey,
      encryptedPrivateKey,
    );
  }

  localStorage.setItem(
    LOCALSTORAGECONSTANTS.relays,
    JSON.stringify(
      relays && relays.length != 0
        ? relays
        : [
            "wss://relay.damus.io",
            "wss://nos.lol",
            "wss://nostr.mutinywallet.com",
            "wss://purplepag.es",
          ],
    ),
  );

  localStorage.setItem(
    LOCALSTORAGECONSTANTS.readRelays,
    JSON.stringify(readRelays && readRelays.length != 0 ? readRelays : []),
  );

  localStorage.setItem(
    LOCALSTORAGECONSTANTS.writeRelays,
    JSON.stringify(writeRelays && writeRelays.length != 0 ? writeRelays : []),
  );

  localStorage.setItem(
    LOCALSTORAGECONSTANTS.cashuWalletRelays,
    JSON.stringify(
      cashuWalletRelays && cashuWalletRelays.length != 0
        ? cashuWalletRelays
        : [],
    ),
  );

  localStorage.setItem(
    LOCALSTORAGECONSTANTS.mints,
    JSON.stringify(mints ? mints : ["https://mint.minibits.cash/Bitcoin"]),
  );

  localStorage.setItem(LOCALSTORAGECONSTANTS.wot, String(wot ? wot : 3));

  window.dispatchEvent(new Event("storage"));
};

export const isUserLoggedIn = () => {
  const { signInMethod, userNPub, userPubkey } = getLocalStorageData();
  if (!signInMethod || !userNPub || !userPubkey) return false;
  return true;
};

export interface LocalStorageInterface {
  signInMethod: string; // extension or nsec
  userNPub: string;
  userPubkey: string;
  relays: string[];
  readRelays: string[];
  writeRelays: string[];
  cashuWalletRelays: string[];
  mints: string[];
  tokens: [];
  history: [];
  wot: number;
  encryptedPrivateKey?: string;
}

export const getLocalStorageData = (): LocalStorageInterface => {
  let signInMethod;
  let encryptedPrivateKey;
  let userNPub;
  let userPubkey;
  let relays;
  let readRelays;
  let writeRelays;
  let cashuWalletRelays;
  let mints;
  let tokens;
  let history;
  let wot;

  if (typeof window !== "undefined") {
    userNPub = localStorage.getItem(LOCALSTORAGECONSTANTS.userNPub);
    userPubkey = localStorage.getItem(LOCALSTORAGECONSTANTS.userPubkey);
    if (!userPubkey && userNPub) {
      const { data } = nip19.decode(userNPub);
      userPubkey = data;
    }

    encryptedPrivateKey = localStorage.getItem(
      LOCALSTORAGECONSTANTS.encryptedPrivateKey,
    );

    signInMethod = localStorage.getItem(LOCALSTORAGECONSTANTS.signInMethod);

    if (signInMethod) {
      // remove old data
      localStorage.removeItem("npub");
      localStorage.removeItem("signIn");
      localStorage.removeItem("chats");
    }

    const relaysString = localStorage.getItem(LOCALSTORAGECONSTANTS.relays);
    relays = relaysString ? (JSON.parse(relaysString) as string[]) : [];

    const defaultRelays = [
      "wss://relay.damus.io",
      "wss://nos.lol",
      "wss://nostr.mutinywallet.com",
      "wss://purplepag.es",
    ];

    if (relays && relays.length === 0) {
      relays = defaultRelays;
      localStorage.setItem("relays", JSON.stringify(relays));
    } else {
      try {
        if (relays) {
          relays = relays.filter((r) => r);
        }
      } catch {
        relays = defaultRelays;
        localStorage.setItem("relays", JSON.stringify(relays));
      }
    }

    readRelays = localStorage.getItem(LOCALSTORAGECONSTANTS.readRelays)
      ? (
          JSON.parse(
            localStorage.getItem(LOCALSTORAGECONSTANTS.readRelays) as string,
          ) as string[]
        ).filter((r) => r)
      : [];

    writeRelays = localStorage.getItem(LOCALSTORAGECONSTANTS.writeRelays)
      ? (
          JSON.parse(
            localStorage.getItem(LOCALSTORAGECONSTANTS.writeRelays) as string,
          ) as string[]
        ).filter((r) => r)
      : [];

    cashuWalletRelays = localStorage.getItem(
      LOCALSTORAGECONSTANTS.cashuWalletRelays,
    )
      ? (
          JSON.parse(
            localStorage.getItem(
              LOCALSTORAGECONSTANTS.cashuWalletRelays,
            ) as string,
          ) as string[]
        ).filter((r) => r)
      : [];

    mints = localStorage.getItem(LOCALSTORAGECONSTANTS.mints)
      ? JSON.parse(localStorage.getItem("mints") as string)
      : null;

    if (
      mints === null ||
      mints[0] ===
        "https://legend.lnbits.com/cashu/api/v1/AptDNABNBXv8gpuywhx6NV" ||
      mints[0] ===
        "https://legend.lnbits.com/cashu/api/v1/4gr9Xcmz3XEkUNwiBiQGoC"
    ) {
      mints = ["https://mint.minibits.cash/Bitcoin"];
      localStorage.setItem(LOCALSTORAGECONSTANTS.mints, JSON.stringify(mints));
    }

    tokens = localStorage.getItem(LOCALSTORAGECONSTANTS.tokens)
      ? JSON.parse(localStorage.getItem("tokens") as string)
      : localStorage.setItem(LOCALSTORAGECONSTANTS.tokens, JSON.stringify([]));

    history = localStorage.getItem(LOCALSTORAGECONSTANTS.history)
      ? JSON.parse(localStorage.getItem("history") as string)
      : localStorage.setItem(LOCALSTORAGECONSTANTS.history, JSON.stringify([]));

    wot = localStorage.getItem(LOCALSTORAGECONSTANTS.wot)
      ? Number(localStorage.getItem(LOCALSTORAGECONSTANTS.wot))
      : 3;
  }
  return {
    signInMethod: signInMethod as string,
    encryptedPrivateKey: encryptedPrivateKey as string,
    userNPub: userNPub as string,
    userPubkey: userPubkey as string,
    relays: relays || [],
    readRelays: readRelays || [],
    writeRelays: writeRelays || [],
    cashuWalletRelays: cashuWalletRelays || [],
    mints,
    tokens: tokens || [],
    history: history || [],
    wot: wot || 3,
  };
};

export const LogOut = () => {
  // remove old data
  localStorage.removeItem("npub");
  localStorage.removeItem("signIn");
  localStorage.removeItem("chats");

  localStorage.removeItem(LOCALSTORAGECONSTANTS.signInMethod);
  localStorage.removeItem(LOCALSTORAGECONSTANTS.userNPub);
  localStorage.removeItem(LOCALSTORAGECONSTANTS.userPubkey);
  localStorage.removeItem(LOCALSTORAGECONSTANTS.encryptedPrivateKey);
  localStorage.removeItem(LOCALSTORAGECONSTANTS.history);

  window.dispatchEvent(new Event("storage"));
};

export const decryptNpub = (npub: string) => {
  const { data } = nip19.decode(npub);
  return data;
};

export function nostrExtensionLoaded() {
  if (!window.nostr) {
    return false;
  }
  return true;
}
