"use client";

import { useEffect, useRef, useState } from "react";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { toSettingsPatch } from "@/components/views/settings/settings-patch";
import { toast } from "@/hooks/use-toast";
import { desktopClient } from "@/lib/desktop-client";
import {
	invalidateProviderCatalogCache,
	loadProviderModelCatalog,
	subscribeToProviderCatalogInvalidation,
} from "@/lib/provider-model-catalog";
import type { Provider } from "@/lib/provider-schema";

export function ProviderPermissionMenu({
	providerId,
	disabled = false,
	onChange,
}: {
	providerId: string;
	disabled?: boolean;
	onChange?: (settings: Record<string, unknown>) => void;
}) {
	const [provider, setProvider] = useState<Provider>();
	const [saving, setSaving] = useState(false);
	const [revision, setRevision] = useState(0);
	const onChangeRef = useRef(onChange);
	onChangeRef.current = onChange;
	useEffect(
		() =>
			subscribeToProviderCatalogInvalidation(() =>
				setRevision((value) => value + 1),
			),
		[],
	);
	// biome-ignore lint/correctness/useExhaustiveDependencies: revision reloads persisted provider settings.
	useEffect(() => {
		let cancelled = false;
		void loadProviderModelCatalog()
			.then((catalog) => {
				if (cancelled) return;
				const selected = catalog.providers.find(
					(entry) => entry.id === providerId,
				);
				setProvider(selected);
				const permission = selected?.configFields?.find(
					(field) => field.chatControl === "permission-mode",
				);
				const stored = permission && selected?.configValues?.[permission.path];
				if (
					permission &&
					stored !== undefined &&
					permission.options?.some((option) => option.value === stored)
				) {
					onChangeRef.current?.(toSettingsPatch({ [permission.path]: stored }));
				}
			})
			.catch(() => {
				if (!cancelled) setProvider(undefined);
			});
		return () => {
			cancelled = true;
		};
	}, [providerId, revision]);
	const field =
		provider?.id === providerId
			? provider.configFields?.find(
					(entry) =>
						entry.chatControl === "permission-mode" && entry.type === "select",
				)
			: undefined;
	if (!field?.options?.length) return null;
	const value = provider?.configValues?.[field.path] ?? field.defaultValue;
	return (
		<Select
			disabled={disabled || saving}
			value={typeof value === "string" ? value : undefined}
			onValueChange={async (next) => {
				if (!field.options?.some((option) => option.value === next)) return;
				setSaving(true);
				try {
					await desktopClient.invoke("save_provider_settings", {
						provider: providerId,
						settings: toSettingsPatch({ [field.path]: next }),
					});
					setProvider((previous) =>
						previous
							? {
									...previous,
									configValues: {
										...previous.configValues,
										[field.path]: next,
									},
								}
							: previous,
					);
					onChange?.(toSettingsPatch({ [field.path]: next }));
					invalidateProviderCatalogCache();
				} catch {
					toast({
						variant: "destructive",
						title: "Permission mode was not saved",
					});
				} finally {
					setSaving(false);
				}
			}}
		>
			<SelectTrigger
				aria-label={field.label}
				title={field.description}
				size="sm"
				className="max-w-52 border-0 shadow-none"
			>
				<SelectValue />
			</SelectTrigger>
			<SelectContent className="max-w-96">
				<div className="px-2 py-1.5 text-xs text-muted-foreground">
					{field.description}
				</div>
				{field.options.map((option) => (
					<SelectItem key={String(option.value)} value={String(option.value)}>
						{option.label}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}
