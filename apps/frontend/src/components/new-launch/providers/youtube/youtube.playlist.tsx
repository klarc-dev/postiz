'use client';

import { FC, useEffect, useState } from 'react';
import { useCustomProviderFunction } from '@gitroom/frontend/components/launches/helpers/use.custom.provider.function';
import { Select } from '@gitroom/react/form/select';
import { useSettings } from '@gitroom/frontend/components/launches/helpers/use.values';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

export const YoutubePlaylist: FC<{
  name: string;
  onChange: (event: {
    target: {
      value: string;
      name: string;
    };
  }) => void;
}> = ({ name, onChange }) => {
  const t = useT();
  const customFunc = useCustomProviderFunction();
  const { getValues } = useSettings();
  const [playlists, setPlaylists] = useState<undefined | any[]>();
  const [currentPlaylist, setCurrentPlaylist] = useState<string | undefined>();

  useEffect(() => {
    customFunc.get('getPlaylists').then((data) => setPlaylists(data));
    const setting = getValues()[name];
    if (setting) {
      setCurrentPlaylist(setting);
    }
  }, []);

  if (!playlists) {
    return null;
  }

  if (!playlists.length) {
    return null;
  }

  return (
    <Select
      name={name}
      label="Playlist (optional)"
      value={currentPlaylist}
      onChange={(event) => {
        setCurrentPlaylist(event.target.value);
        onChange(event);
      }}
    >
      <option value="">{t('youtube_no_playlist', 'No playlist')}</option>
      {playlists.map((playlist: any) => (
        <option key={playlist.id} value={playlist.id}>
          {playlist.name}
        </option>
      ))}
    </Select>
  );
};
