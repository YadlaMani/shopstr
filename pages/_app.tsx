import "tailwindcss/tailwind.css";
import type { AppProps } from "next/app";
import "../styles/globals.css";
import Navbar from "./components/navbar";
import { useState, useEffect } from "react";
import { useRouter } from "next/router";
import { SimplePool, nip19 } from "nostr-tools";
import {
  ProfileMapContext,
  ProfileContextInterface,
  ProductContext,
  ProductContextInterface,
  ChatContext,
  ChatContextInterface,
  MessageContext,
  MessageContextInterface,
  ChatsContext,
} from "./context";
import {
  decryptNpub,
  getLocalStorageData,
  LocalStorageInterface,
  NostrEvent,
} from "./components/utility/nostr-helper-functions";
import { NextUIProvider } from "@nextui-org/react";
import { ThemeProvider as NextThemesProvider } from "next-themes";
import { CashuMint, CashuWallet } from "@cashu/cashu-ts";
import {
  fetchAllPosts,
  fetchChatsAndMessages,
  fetchProfile,
} from "./api/nostr/fetch-service";

function App({ Component, pageProps }: AppProps) {
  const router = useRouter();
  const isSignInPage = router.pathname === "/sign-in";
  const isKeyPage = router.pathname === "/keys";
  const [localStorageValues, setLocalStorageValues] =
    useState<LocalStorageInterface>(getLocalStorageData());
  const [productContext, setProductContext] = useState<ProductContextInterface>(
    {
      productEvents: [],
      isLoading: true,
    },
  );
  const [profileMap, setProfileMap] = useState(new Map());
  const [profileContext, setProfileContext] = useState<ProfileContextInterface>(
    {
      profileData: new Map(),
      mergeProfileMaps: (newProfileMap: Map<string, any>) => {
        setProfileMap((profileMap) => {
          return new Map([...profileMap, ...newProfileMap]);
        });
      },
    },
  );
  const [chatsContext, setChatsContext] = useState<ChatContextInterface>({
    chatPubkeys: new Map(),
    isLoading: true,
  });

  /** FETCH initial PRODUCTS and PROFILES **/
  useEffect(() => {
    const relays = localStorageValues.relays;
    async function fetchData() {
      try {
        let websocketSubscribers = [];
        let { productsWebsocketSub, profileArray } = await fetchAllPosts(
          relays,
          setProductContext,
        );
        websocketSubscribers.push(productsWebsocketSub);
        let { decryptedNpub } = getLocalStorageData();
        let { profileMap } = await fetchProfile(relays, [
          decryptedNpub as string,
          ...profileArray,
        ]);
        profileContext.mergeProfileMaps(profileMap);

        let chatMap = await fetchChatsAndMessages(relays, decryptedNpub);
        console.log(chatMap);
        setChatsContext({
          chats: chatMap,
          isLoading: false,
        });
      } catch (error) {
        console.error("Error fetching data:", error);
      }
    }
    if (relays) fetchData(); // Call the async function immediately
  }, [localStorageValues.relays]);

  /** UPON PROFILEMAP UPDATE, SET PROFILE CONTEXT **/
  useEffect(() => {
    setProfileContext((profileContext: ProfileContextInterface) => {
      return {
        profileData: profileMap,
        mergeProfileMaps: profileContext.mergeProfileMaps,
      };
    });
  }, [profileMap]);

  return (
    <ProductContext.Provider value={productContext}>
      <ProfileMapContext.Provider value={profileContext}>
        <ChatsContext.Provider value={chatsContext}>
          <NextUIProvider>
            <NextThemesProvider
              attribute="class"
              forcedTheme={Component.theme || undefined}
            >
              <div className="h-[100vh] bg-light-bg dark:bg-dark-bg">
                {isSignInPage || isKeyPage ? null : <Navbar />}
                <div className="h-20">
                  {/*spacer div needed so pages can account for navbar height*/}
                </div>
                <Component {...pageProps} />
              </div>
            </NextThemesProvider>
          </NextUIProvider>
        </ChatsContext.Provider>
      </ProfileMapContext.Provider>
    </ProductContext.Provider>
  );
}

export default App;
