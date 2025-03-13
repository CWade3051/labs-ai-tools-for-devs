import React, { Suspense, useEffect, useState } from 'react';
import { IconButton, Alert, Stack, Button, Typography, FormGroup, FormControlLabel, Dialog, DialogTitle, DialogContent, Checkbox, Badge, BadgeProps, Link, TextField, Tabs, Tab, Tooltip, CircularProgress, Box } from '@mui/material';
import { CatalogItemWithName, CatalogItem } from './PromptCard';
import { v1 } from "@docker/extension-api-client-types";
import { parse, stringify } from 'yaml';
import { getRegistry, syncConfigWithRegistry, syncRegistryWithConfig } from '../Registry';
import { FolderOpenRounded, Search, Settings } from '@mui/icons-material';
import { tryRunImageSync } from '../FileWatcher';
import { CATALOG_URL, POLL_INTERVAL } from '../Constants';
import Secrets from '../Secrets';
import { ParsedParameters } from './PromptConfig';

const ToolCatalog = React.lazy(() => import('./tabs/ToolCatalog'));
const YourTools = React.lazy(() => import('./tabs/YourTools'));
const YourEnvironment = React.lazy(() => import('./tabs/YourEnvironment'));

interface CatalogGridProps {
    registryItems: { [key: string]: { ref: string, config: any } };
    canRegister: boolean;
    client: v1.DockerDesktopClient;
    onRegistryChange: () => void;
    showSettings: () => void;
    settingsBadgeProps: BadgeProps;
    setConfiguringItem: (item: CatalogItemWithName) => void;
    config: { [key: string]: { [key: string]: ParsedParameters } };
}

const filterCatalog = (catalogItems: CatalogItemWithName[], registryItems: { [key: string]: { ref: string } }, search: string) =>
    catalogItems.filter((item) => item.name.toLowerCase().includes(search.toLowerCase()));

const parseDDVersion = (ddVersion: string) => {
    //eg: Docker Desktop 4.40.0 (184396)
    const [, , version, build] = ddVersion.split(' ');
    return {
        version,
        build: parseInt(build.replace('(', '').replace(')', ''))
    }
}
const NEVER_SHOW_AGAIN_KEY = 'registry-sync-never-show-again';

export const CatalogGrid: React.FC<CatalogGridProps> = ({
    registryItems,
    canRegister,
    client,
    onRegistryChange,
    showSettings,
    settingsBadgeProps,
    setConfiguringItem,
    config
}) => {
    const [catalogItems, setCatalogItems] = useState<CatalogItemWithName[]>([]);
    const [showReloadModal, setShowReloadModal] = useState<boolean>(false);
    const [search, setSearch] = useState<string>('');
    const [tab, setTab] = useState<number>(0);
    const [secrets, setSecrets] = useState<Secrets.Secret[]>([]);
    const [ddVersion, setDdVersion] = useState<{ version: string, build: number } | null>(null);

    const filteredCatalogItems = filterCatalog(catalogItems, registryItems, search);

    const loadCatalog = async (showNotification = true) => {
        const cachedCatalog = localStorage.getItem('catalog');
        try {
            const response = await fetch(CATALOG_URL);
            const catalog = await response.text();
            const items = parse(catalog)['registry'] as { [key: string]: CatalogItem }
            const itemsWithName = Object.entries(items).map(([name, item]) => ({ name, ...item }));
            const filteredItems = filterCatalog(itemsWithName, registryItems, search);
            setCatalogItems(filteredItems);
            localStorage.setItem('catalog', JSON.stringify(filteredItems));
            if (showNotification) {
                client.desktopUI.toast.success('Catalog updated successfully.');
            }
        }
        catch (error) {
            if (cachedCatalog) {
                setCatalogItems(JSON.parse(cachedCatalog));
            }
            if (showNotification) {
                client.desktopUI.toast.error(`Failed to get latest catalog.${cachedCatalog ? ' Using cached catalog.' : ''}` + error);
            }
        }
    }

    const loadSecrets = async () => {
        const response = await Secrets.getSecrets(client);
        setSecrets(response || []);
    }

    const loadDDVersion = async () => {
        const ddVersionResult = await client.docker.cli.exec('version', ['--format', 'json'])
        setDdVersion(parseDDVersion(JSON.parse(ddVersionResult.stdout).Server.Platform.Name));
    }

    const registerCatalogItem = async (item: CatalogItemWithName, showNotification = true) => {
        try {
            const currentRegistry = await getRegistry(client);
            const newRegistry = { ...currentRegistry, [item.name]: { ref: item.ref } };
            const payload = JSON.stringify({
                files: [{
                    path: 'registry.yaml',
                    content: stringify({ registry: newRegistry })
                }]
            })
            await tryRunImageSync(client, ['--rm', '-v', 'docker-prompts:/docker-prompts', '--workdir', '/docker-prompts', 'vonwig/function_write_files:latest', `'${payload}'`])
            if (showNotification) {
                client.desktopUI.toast.success('Prompt registered successfully. Restart Claude Desktop to apply.');
            }
            onRegistryChange();
            if (showNotification) {
                setShowReloadModal(!localStorage.getItem(NEVER_SHOW_AGAIN_KEY));
            }
            await syncConfigWithRegistry(client);
            await syncRegistryWithConfig(client);
        }
        catch (error) {
            if (showNotification) {
                client.desktopUI.toast.error('Failed to register prompt: ' + error);
            }
        }
    }

    const unregisterCatalogItem = async (item: CatalogItemWithName) => {
        try {
            const currentRegistry = await getRegistry(client);
            delete currentRegistry[item.name];
            const payload = JSON.stringify({
                files: [{
                    path: 'registry.yaml',
                    content: stringify({ registry: currentRegistry })
                }]
            })
            await tryRunImageSync(client, ['--rm', '-v', 'docker-prompts:/docker-prompts', '--workdir', '/docker-prompts', 'vonwig/function_write_files:latest', `'${payload}'`])
            client.desktopUI.toast.success('Prompt unregistered successfully. Restart Claude Desktop to apply.');
            onRegistryChange();
            setShowReloadModal(!localStorage.getItem(NEVER_SHOW_AGAIN_KEY));
            await syncConfigWithRegistry(client);
            await syncRegistryWithConfig(client);
        }
        catch (error) {
            client.desktopUI.toast.error('Failed to unregister prompt: ' + error)
        }
    }

    useEffect(() => {
        loadCatalog(false);
        loadSecrets();
        loadDDVersion();
        const interval = setInterval(() => {
            loadCatalog(false);
            loadSecrets();
        }, POLL_INTERVAL);
        return () => {
            clearInterval(interval);
        }
    }, []);

    const hasOutOfCatalog = catalogItems.length > 0 && Object.keys(registryItems).length > 0 && !Object.keys(registryItems).every((i) =>
        catalogItems.some((c) => c.name === i)
    )

    if (!ddVersion) {
        return <CircularProgress />
    }


    return (
        <Stack spacing={2} justifyContent='center' alignItems='center'>
            <Dialog open={showReloadModal} onClose={() => setShowReloadModal(false)}>
                <DialogTitle>Registry Updated</DialogTitle>
                <DialogContent>
                    <Typography sx={{ marginBottom: 2 }}>
                        You have updated the registry.
                        Use the keybind {client.host.platform === 'win32' ? 'Ctrl' : '⌘'} + R to refresh MCP servers in Claude Desktop.
                    </Typography>
                    <Stack direction="row" justifyContent="space-between">
                        <Button onClick={() => {
                            setShowReloadModal(false)
                        }}>Close</Button>
                        <FormControlLabel control={<Checkbox defaultChecked={Boolean(localStorage.getItem(NEVER_SHOW_AGAIN_KEY))} onChange={(e) => localStorage.setItem(NEVER_SHOW_AGAIN_KEY, e.target.checked.toString())} />} label="Don't show this again" />
                    </Stack>
                </DialogContent>
            </Dialog>
            {hasOutOfCatalog && <Alert action={<Button startIcon={<FolderOpenRounded />} variant='outlined' color='secondary' onClick={() => {
                client.desktopUI.navigate.viewVolume('docker-prompts')
            }}>registry.yaml</Button>} severity="info">
                <Typography sx={{ width: '100%' }}>You have some prompts registered which are not available in the catalog.</Typography>
            </Alert>}
            <Tabs value={tab} onChange={(_, newValue) => setTab(newValue)} sx={{ width: '100%' }}>
                <Tooltip title="These are all of the tiles you have available across the catalog.">
                    <Tab sx={{ fontSize: '1.5em' }} label="Tool Catalog" />
                </Tooltip>
                <Tooltip title="These are tiles which you have allowed MCP clients to use.">
                    <Tab sx={{ fontSize: '1.5em' }} label="Your Tools" />
                </Tooltip>
                <Tooltip title="These are environment variables and secrets which you have set for your MCP clients.">
                    <Tab sx={{ fontSize: '1.5em' }} label="Your Environment" />
                </Tooltip>
            </Tabs>
            <FormGroup sx={{ width: '100%', mt: 0 }}>
                <Stack direction="row" spacing={1} alignItems='center' justifyContent="space-evenly">
                    <TextField label="Search" value={search} onChange={(e) => setSearch(e.target.value)} />
                    <Link sx={{ fontWeight: 'bold', justifySelf: 'flex-end', marginLeft: 'auto', }} href="https://vonwig.github.io/prompts.docs/tools/docs/" target="_blank" rel="noopener noreferrer" onClick={() => {
                        client.host.openExternal('https://vonwig.github.io/prompts.docs/tools/docs/');
                    }}>⇱ Documentation</Link>
                    <Link sx={{ fontWeight: 'bold', }} href="https://github.com/docker/labs-ai-tools-for-devs" target="_blank" rel="noopener noreferrer" onClick={() => {
                        client.host.openExternal('https://github.com/docker/labs-ai-tools-for-devs');
                    }}>⇱ GitHub</Link>
                    <IconButton sx={{ ml: 2, alignSelf: 'flex-end', justifyContent: 'flex-end' }} onClick={showSettings}>
                        <Badge {...settingsBadgeProps}>
                            <Settings sx={{ fontSize: '1.5em' }} />
                        </Badge>
                    </IconButton>
                </Stack>
            </FormGroup>

            <Suspense fallback={<Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}><CircularProgress /></Box>}>
                {tab === 0 && (
                    <ToolCatalog
                        registryItems={registryItems}
                        config={config}
                        search={search}
                        catalogItems={catalogItems}
                        client={client}
                        ddVersion={ddVersion}
                        canRegister={canRegister}
                        register={registerCatalogItem}
                        unregister={unregisterCatalogItem}
                        onSecretChange={loadSecrets}
                        secrets={secrets}
                        setConfiguringItem={setConfiguringItem}
                    />
                )}
                {tab === 1 && (
                    <YourTools
                        search={search}
                        registryItems={registryItems}
                        config={config}
                        ddVersion={ddVersion}
                        canRegister={canRegister}
                        setConfiguringItem={setConfiguringItem}
                        secrets={secrets}
                    />
                )}
                {tab === 2 && ddVersion && (
                    <YourEnvironment
                        secrets={secrets}
                        ddVersion={ddVersion}
                        config={config}
                    />
                )}
            </Suspense>
        </Stack>
    );
};
