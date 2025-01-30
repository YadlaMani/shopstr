import React, { useEffect, useState, useContext, useMemo } from "react";
import { useForm, Controller } from "react-hook-form";
import { Button, Textarea, Input, Image } from "@nextui-org/react";
import { ArrowUpOnSquareIcon } from "@heroicons/react/24/outline";

import { SettingsBreadCrumbs } from "@/components/settings/settings-bread-crumbs";
import { ShopMapContext } from "@/utils/context/context";
import { SHOPSTRBUTTONCLASSNAMES } from "@/components/utility/STATIC-VARIABLES";
import {
  getNsecWithPassphrase,
  getLocalStorageData,
  validPassphrase,
} from "@/components/utility/nostr-helper-functions";
import { FileUploaderButton } from "@/components/utility-components/file-uploader";
import RequestPassphraseModal from "@/components/utility-components/request-passphrase-modal";
import ShopstrSpinner from "@/components/utility-components/shopstr-spinner";
import { createNostrShopEvent } from "../api/nostr/crud-service";

const ShopSettingsPage = () => {
  const [enterPassphrase, setEnterPassphrase] = useState(false);
  const [passphrase, setPassphrase] = useState("");
  const [isUploadingShopSettings, setIsUploadingShopSettings] = useState(false);
  const [isFetchingShop, setIsFetchingShop] = useState(false);
  const [userPubkey, setUserPubkey] = useState("");

  const { signInMethod } = getLocalStorageData();

  const shopContext = useContext(ShopMapContext);
  const { handleSubmit, control, reset, watch, setValue } = useForm({
    defaultValues: {
      banner: "",
      picture: "",
      name: "",
      about: "",
    },
  });

  useEffect(() => {
    setUserPubkey(getLocalStorageData().userPubkey);
  }, []);

  const watchBanner = watch("banner");
  const watchPicture = watch("picture");
  const defaultImage = "/shopstr-2000x2000.png";

  useEffect(() => {
    if (signInMethod === "nsec" && !validPassphrase(passphrase)) {
      setEnterPassphrase(true); // prompt for passphrase when chatsContext is loaded
    } else {
      setIsFetchingShop(true);
      const shopMap = shopContext.shopData;

      const shop = shopMap.has(userPubkey)
        ? shopMap.get(userPubkey)
        : undefined;
      if (shop) {
        const mappedContent = {
          name: shop.content.name,
          about: shop.content.about,
          picture: shop.content.ui.picture,
          banner: shop.content.ui.banner,
        };
        reset(mappedContent);
      }
      setIsFetchingShop(false);
    }
  }, [shopContext, userPubkey, passphrase]);

  const onSubmit = async (data: { [x: string]: string }) => {
    setIsUploadingShopSettings(true);
    const transformedData = {
      name: data.name || "",
      about: data.about || "",
      ui: {
        picture: data.picture || "",
        banner: data.banner || "",
        theme: "",
        darkMode: false,
      },
      merchants: [userPubkey],
    };
    await createNostrShopEvent(
      userPubkey,
      JSON.stringify(transformedData),
      passphrase,
    );
    shopContext.updateShopData({
      pubkey: userPubkey,
      content: transformedData,
      created_at: 0,
    });
    setIsUploadingShopSettings(false);
  };

  const isButtonDisabled = useMemo(() => {
    if (signInMethod === "extension" || signInMethod === "bunker") return false;
    if (passphrase === "") return true;
    try {
      let nsec = getNsecWithPassphrase(passphrase);
      if (!nsec) return true;
    } catch (e) {
      return true;
    }
    return false;
  }, [signInMethod, passphrase]);

  const buttonClassName = useMemo(() => {
    const disabledStyle = "from-gray-300 to-gray-400 cursor-not-allowed";
    const enabledStyle = SHOPSTRBUTTONCLASSNAMES;
    const className = isButtonDisabled ? disabledStyle : enabledStyle;
    return `w-full mb-10 ${className}`;
  }, [isButtonDisabled]);

  return (
    <>
      <div className="flex min-h-screen flex-col bg-light-bg pt-24 dark:bg-dark-bg md:pb-20">
        <div className="h-full w-full px-4 lg:w-1/2">
          <SettingsBreadCrumbs />
          {isFetchingShop ? (
            <ShopstrSpinner />
          ) : (
            <>
              <div className="mb-20 h-40 rounded-lg bg-light-fg dark:bg-dark-fg">
                <div className="relative flex h-40 items-center justify-center rounded-lg bg-shopstr-purple-light dark:bg-dark-fg">
                  {watchBanner && (
                    <Image
                      alt={"Shop banner image"}
                      src={watchBanner}
                      className="h-40 w-full rounded-lg object-cover object-fill"
                    />
                  )}
                  <FileUploaderButton
                    isIconOnly={false}
                    className={`absolute bottom-5 right-5 z-20 ${SHOPSTRBUTTONCLASSNAMES}`}
                    passphrase={passphrase}
                    imgCallbackOnUpload={(imgUrl) => setValue("banner", imgUrl)}
                  >
                    Upload Banner
                  </FileUploaderButton>
                </div>
                <div className="flex items-center justify-center">
                  <div className="relative z-50 mt-[-3rem] h-24 w-24">
                    <div className="">
                      <FileUploaderButton
                        isIconOnly
                        className={`absolute bottom-[-0.5rem] right-[-0.5rem] z-20 ${SHOPSTRBUTTONCLASSNAMES}`}
                        passphrase={passphrase}
                        imgCallbackOnUpload={(imgUrl) =>
                          setValue("picture", imgUrl)
                        }
                      >
                        <ArrowUpOnSquareIcon className="h-6 w-6" />
                      </FileUploaderButton>
                      {watchPicture ? (
                        <Image
                          src={watchPicture}
                          alt="shop logo"
                          className="rounded-full"
                        />
                      ) : (
                        <Image
                          src={defaultImage}
                          alt="shop logo"
                          className="rounded-full"
                        />
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <form onSubmit={handleSubmit(onSubmit as any)}>
                <Controller
                  name="name"
                  control={control}
                  rules={{
                    maxLength: {
                      value: 50,
                      message: "This input exceed maxLength of 50.",
                    },
                  }}
                  render={({
                    field: { onChange, onBlur, value },
                    fieldState: { error },
                  }) => {
                    let isErrored = error !== undefined;
                    let errorMessage: string = error?.message
                      ? error.message
                      : "";
                    return (
                      <Input
                        className="pb-4 text-light-text dark:text-dark-text"
                        classNames={{
                          label: "text-light-text dark:text-dark-text text-lg",
                        }}
                        variant="bordered"
                        fullWidth={true}
                        label="Shop Name"
                        labelPlacement="outside"
                        isInvalid={isErrored}
                        errorMessage={errorMessage}
                        placeholder="Add your shop's name . . ."
                        // controller props
                        onChange={onChange} // send value to hook form
                        onBlur={onBlur} // notify when input is touched/blur
                        value={value}
                      />
                    );
                  }}
                />

                <Controller
                  name="about"
                  control={control}
                  rules={{
                    maxLength: {
                      value: 500,
                      message: "This input exceed maxLength of 500.",
                    },
                  }}
                  render={({
                    field: { onChange, onBlur, value },
                    fieldState: { error },
                  }) => {
                    let isErrored = error !== undefined;
                    let errorMessage: string = error?.message
                      ? error.message
                      : "";
                    return (
                      <Textarea
                        className="pb-4 text-light-text dark:text-dark-text"
                        classNames={{
                          label: "text-light-text dark:text-dark-text text-lg",
                        }}
                        variant="bordered"
                        fullWidth={true}
                        placeholder="Add something about your shop . . ."
                        isInvalid={isErrored}
                        errorMessage={errorMessage}
                        label="About"
                        labelPlacement="outside"
                        // controller props
                        onChange={onChange} // send value to hook form
                        onBlur={onBlur} // notify when input is touched/blur
                        value={value}
                      />
                    );
                  }}
                />

                <Button
                  className={buttonClassName}
                  type="submit"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !isButtonDisabled) {
                      e.preventDefault(); // Prevent default to avoid submitting the form again
                      handleSubmit(onSubmit as any)(); // Programmatic submit
                    }
                  }}
                  isDisabled={isUploadingShopSettings}
                  isLoading={isUploadingShopSettings}
                >
                  Save Shop
                </Button>
              </form>
            </>
          )}
        </div>
      </div>
      <RequestPassphraseModal
        passphrase={passphrase}
        setCorrectPassphrase={setPassphrase}
        isOpen={enterPassphrase}
        setIsOpen={setEnterPassphrase}
        onCancelRouteTo="/settings"
      />
    </>
  );
};

export default ShopSettingsPage;
