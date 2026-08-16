import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PAYMENT_METHODS } from "@/lib/payments";

type Props = {
  isEdit: boolean;
  method: string;
  onMethod: (v: string) => void;
  recordPayment: boolean;
  onRecordPayment: (v: boolean) => void;
};

/** Champs financiers communs : moyen de paiement + enregistrement d'un renouvellement. */
export function PaymentFields({ isEdit, method, onMethod, recordPayment, onRecordPayment }: Props) {
  return (
    <div className="col-span-2 space-y-3 rounded-xl border border-border p-3">
      {isEdit && (
        <>
          <p className="text-xs text-muted-foreground">
            Modifier le montant met à jour le dernier paiement : historique et solde suivent.
          </p>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={recordPayment} onChange={(e) => onRecordPayment(e.target.checked)} />
            Enregistrer un paiement de renouvellement
          </label>
        </>
      )}
      {(!isEdit || recordPayment) && (
        <div className="space-y-2">
          <Label>Moyen de paiement</Label>
          <Select value={method} onValueChange={onMethod}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {PAYMENT_METHODS.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">Ce montant est ajouté au solde.</p>
        </div>
      )}
    </div>
  );
}
