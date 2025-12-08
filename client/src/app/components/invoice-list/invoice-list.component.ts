import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { InvoiceService } from '../../services/invoice.service';
import { InvoiceView } from '../../models/invoice-view.model';

@Component({
  selector: 'app-invoice-list',
  templateUrl: './invoice-list.component.html',
  styleUrls: ['./invoice-list.component.css'],
  standalone: true,
  imports: [CommonModule]
})
export class InvoiceListComponent implements OnInit {
  invoices: InvoiceView[] = [];

  constructor(private invoiceService: InvoiceService) { }

  ngOnInit(): void {
    this.invoiceService.getInvoices().subscribe((data: InvoiceView[]) => {
      this.invoices = data;
    });
  }
}
